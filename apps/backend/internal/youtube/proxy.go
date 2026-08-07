package youtube

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
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

	upstream, err := http.NewRequestWithContext(r.Context(), r.Method, info.URL, nil)
	if err != nil {
		return fmt.Errorf("%w: build upstream: %v", ErrResolveFail, err)
	}

	// Forward range / conditional headers needed for seeking.
	for _, key := range []string{"Range", "If-Range", "If-None-Match", "If-Modified-Since"} {
		if value := r.Header.Get(key); value != "" {
			upstream.Header.Set(key, value)
		}
	}
	upstream.Header.Set("User-Agent", "Mozilla/5.0 (compatible; JedFlix/1.0)")
	upstream.Header.Set("Accept", "*/*")

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 30 * time.Second
	transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext

	client := &http.Client{
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

	resp, err := client.Do(upstream)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		return fmt.Errorf("%w: upstream fetch failed", ErrResolveFail)
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" || strings.HasPrefix(contentType, "application/octet-stream") {
		if info.ContentType != "" {
			contentType = info.ContentType
		}
	}
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
	w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, Content-Type")

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

func copyHeader(w http.ResponseWriter, resp *http.Response, key string) {
	if value := resp.Header.Get(key); value != "" {
		w.Header().Set(key, value)
	}
}

// ResolveTimeout is the max time allowed for yt-dlp search + extract.
const ResolveTimeout = 45 * time.Second
