package youtube

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var allowedAudioHostSuffixes = []string{
	"googlevideo.com",
	"googleusercontent.com",
	"youtube.com",
	"youtu.be",
	"ytimg.com",
	"ggpht.com",
}

// testAllowedHosts is populated only from tests via AllowHostsForTest.
var testAllowedHosts []string

// googlevideo DASH URLs 403 unless Range has both a start and an end.
// HTML5 audio often sends no Range or `bytes=0-`; we convert those to closed
// chunks and stitch them so the client still gets a complete stream.
var upstreamChunkSize int64 = 512 * 1024

const googlevideoUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// AllowHostsForTest adds temporary upstream hostnames for unit tests.
func AllowHostsForTest(hosts ...string) {
	testAllowedHosts = append([]string(nil), hosts...)
}

// Proxy streams remote audio to the client without writing files to disk.
// Supports Range / seeking for HTML5 Audio and iOS PWA playback.
func Proxy(w http.ResponseWriter, r *http.Request, info *StreamInfo) error {
	if info == nil || strings.TrimSpace(info.URL) == "" {
		return ErrNotFound
	}
	if err := validateUpstreamURL(info.URL); err != nil {
		return fmt.Errorf("%w: %v", ErrResolveFail, err)
	}

	clientRange, hasClientRange := parseBytesRange(r.Header.Get("Range"))
	firstEnd := clientRange.start + chunkSize() - 1
	if clientRange.hasEnd && clientRange.end < firstEnd {
		firstEnd = clientRange.end
	}

	client := newUpstreamClient()
	resp, err := fetchUpstream(r, client, info.URL, clientRange.start, firstEnd, true)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		return err
	}
	defer resp.Body.Close()

	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	if !isPlayableUpstreamStatus(status) {
		return fmt.Errorf("%w: upstream status %d", ErrResolveFail, status)
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" || strings.HasPrefix(contentType, "application/octet-stream") {
		if info.ContentType != "" {
			contentType = info.ContentType
		}
	}
	if !looksLikeAudioContentType(contentType) {
		return fmt.Errorf("%w: upstream content-type %s", ErrResolveFail, contentType)
	}

	// Progressive URLs may ignore Range and return 200 with the full body.
	if status == http.StatusOK && resp.Header.Get("Content-Range") == "" {
		return copySingleResponse(w, r, resp, info, contentType)
	}

	chunkStart, chunkEnd, total, ok := parseContentRange(resp.Header.Get("Content-Range"))
	if !ok || total <= 0 {
		return copySingleResponse(w, r, resp, info, contentType)
	}

	serveStart := clientRange.start
	if chunkStart < serveStart {
		serveStart = chunkStart
	}
	serveEnd := total - 1
	if clientRange.hasEnd && clientRange.end < serveEnd {
		serveEnd = clientRange.end
	}
	if serveEnd < serveStart {
		return fmt.Errorf("%w: empty upstream range", ErrResolveFail)
	}

	WriteMetadataHeaders(w, info)
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Accept-Ranges", "bytes")
	copyHeader(w, resp, "ETag")
	copyHeader(w, resp, "Last-Modified")
	copyHeader(w, resp, "Cache-Control")
	w.Header().Set("Access-Control-Expose-Headers", exposedAudioHeaders())

	serveLen := serveEnd - serveStart + 1
	if hasClientRange {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", serveStart, serveEnd, total))
		w.Header().Set("Content-Length", strconv.FormatInt(serveLen, 10))
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.Header().Set("Content-Length", strconv.FormatInt(serveLen, 10))
		w.WriteHeader(http.StatusOK)
	}

	if r.Method == http.MethodHead {
		return nil
	}

	remaining := serveLen
	copied, copyErr := io.CopyN(w, resp.Body, minInt64(remaining, chunkEnd-chunkStart+1))
	flushWriter(w)
	if copyErr != nil && copyErr != io.EOF {
		return copyErr
	}
	remaining -= copied
	next := chunkStart + copied

	for remaining > 0 {
		if err := r.Context().Err(); err != nil {
			return err
		}
		nextEnd := next + chunkSize() - 1
		if nextEnd > serveEnd {
			nextEnd = serveEnd
		}
		part, partErr := fetchUpstream(r, client, info.URL, next, nextEnd, false)
		if partErr != nil {
			return partErr
		}
		if !isPlayableUpstreamStatus(part.StatusCode) {
			_ = part.Body.Close()
			return fmt.Errorf("%w: upstream status %d", ErrResolveFail, part.StatusCode)
		}
		n, partCopyErr := io.CopyN(w, part.Body, remaining)
		_ = part.Body.Close()
		flushWriter(w)
		if partCopyErr != nil && partCopyErr != io.EOF {
			return partCopyErr
		}
		if n == 0 {
			return fmt.Errorf("%w: upstream returned empty chunk", ErrResolveFail)
		}
		remaining -= n
		next += n
	}
	return nil
}

func copySingleResponse(w http.ResponseWriter, r *http.Request, resp *http.Response, info *StreamInfo, contentType string) error {
	WriteMetadataHeaders(w, info)
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	copyHeader(w, resp, "Accept-Ranges")
	copyHeader(w, resp, "Content-Length")
	copyHeader(w, resp, "Content-Range")
	copyHeader(w, resp, "ETag")
	copyHeader(w, resp, "Last-Modified")
	copyHeader(w, resp, "Cache-Control")
	if w.Header().Get("Accept-Ranges") == "" {
		w.Header().Set("Accept-Ranges", "bytes")
	}
	w.Header().Set("Access-Control-Expose-Headers", exposedAudioHeaders())
	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	if r.Method == http.MethodHead {
		return nil
	}
	_, copyErr := io.Copy(w, resp.Body)
	return copyErr
}

func newUpstreamClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	return &http.Client{
		Timeout:   0, // stream until client disconnects
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if err := validateUpstreamURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

func fetchUpstream(r *http.Request, client *http.Client, rawURL string, start, end int64, conditional bool) (*http.Response, error) {
	if end < start {
		return nil, fmt.Errorf("%w: invalid upstream range", ErrResolveFail)
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build upstream: %v", ErrResolveFail, err)
	}
	if conditional {
		for _, key := range []string{"If-Range", "If-None-Match", "If-Modified-Since"} {
			if value := r.Header.Get(key); value != "" {
				req.Header.Set(key, value)
			}
		}
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	req.Header.Set("User-Agent", googlevideoUserAgent)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Referer", "https://www.youtube.com/")

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, err
		}
		return nil, fmt.Errorf("%w: upstream fetch failed", ErrResolveFail)
	}
	return resp, nil
}

type byteSpan struct {
	start  int64
	end    int64
	hasEnd bool
}

func parseBytesRange(header string) (byteSpan, bool) {
	header = strings.TrimSpace(header)
	if header == "" {
		return byteSpan{}, false
	}
	if !strings.HasPrefix(strings.ToLower(header), "bytes=") {
		return byteSpan{}, false
	}
	spec := strings.TrimSpace(header[len("bytes="):])
	if i := strings.IndexByte(spec, ','); i >= 0 {
		spec = spec[:i]
	}
	startStr, endStr, ok := strings.Cut(spec, "-")
	if !ok {
		return byteSpan{}, false
	}
	startStr = strings.TrimSpace(startStr)
	endStr = strings.TrimSpace(endStr)
	if startStr == "" {
		return byteSpan{}, false
	}
	start, err := strconv.ParseInt(startStr, 10, 64)
	if err != nil || start < 0 {
		return byteSpan{}, false
	}
	if endStr == "" {
		return byteSpan{start: start}, true
	}
	end, err := strconv.ParseInt(endStr, 10, 64)
	if err != nil || end < start {
		return byteSpan{}, false
	}
	return byteSpan{start: start, end: end, hasEnd: true}, true
}

func parseContentRange(header string) (start, end, total int64, ok bool) {
	header = strings.TrimSpace(header)
	if !strings.HasPrefix(strings.ToLower(header), "bytes ") {
		return 0, 0, 0, false
	}
	spec := strings.TrimSpace(header[len("bytes "):])
	rangePart, totalPart, found := strings.Cut(spec, "/")
	if !found {
		return 0, 0, 0, false
	}
	startStr, endStr, found := strings.Cut(strings.TrimSpace(rangePart), "-")
	if !found {
		return 0, 0, 0, false
	}
	start, err := strconv.ParseInt(strings.TrimSpace(startStr), 10, 64)
	if err != nil {
		return 0, 0, 0, false
	}
	end, err = strconv.ParseInt(strings.TrimSpace(endStr), 10, 64)
	if err != nil {
		return 0, 0, 0, false
	}
	totalPart = strings.TrimSpace(totalPart)
	if totalPart == "*" {
		return start, end, 0, true
	}
	total, err = strconv.ParseInt(totalPart, 10, 64)
	if err != nil || total <= 0 {
		return 0, 0, 0, false
	}
	return start, end, total, true
}

func chunkSize() int64 {
	if upstreamChunkSize <= 0 {
		return 512 * 1024
	}
	return upstreamChunkSize
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func flushWriter(w http.ResponseWriter) {
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func validateUpstreamURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid upstream URL")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("upstream scheme not allowed")
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return fmt.Errorf("upstream host missing")
	}
	for _, allowed := range testAllowedHosts {
		if host == strings.ToLower(allowed) {
			return nil
		}
	}
	if ip := net.ParseIP(host); ip != nil {
		return fmt.Errorf("upstream host not allowed")
	}
	for _, suffix := range allowedAudioHostSuffixes {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return nil
		}
	}
	return fmt.Errorf("upstream host not allowed")
}

func IsRetryableProxyError(err error) bool {
	if err == nil {
		return false
	}
	if !errors.Is(err, ErrResolveFail) {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "upstream status") ||
		strings.Contains(msg, "upstream content-type") ||
		strings.Contains(msg, "upstream fetch failed")
}

func copyHeader(w http.ResponseWriter, resp *http.Response, key string) {
	if value := resp.Header.Get(key); value != "" {
		w.Header().Set(key, value)
	}
}

// ResolveTimeout is the max time allowed for yt-dlp search + extract.
const ResolveTimeout = 45 * time.Second
