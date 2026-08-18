package youtube

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestProxyForwardsRange(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Fatalf("expected Range header, got %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Type", "audio/mp4")
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Range", "bytes 0-3/8")
		w.Header().Set("Content-Length", "4")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("abcd"))
	}))
	defer upstream.Close()

	parsedURL := upstream.URL
	host := strings.TrimPrefix(strings.TrimPrefix(parsedURL, "http://"), "https://")
	if idx := strings.Index(host, "/"); idx >= 0 {
		host = host[:idx]
	}
	if idx := strings.Index(host, ":"); idx >= 0 {
		host = host[:idx]
	}
	AllowHostsForTest(host)
	defer AllowHostsForTest()

	req := httptest.NewRequest(http.MethodGet, "/audio", nil)
	req.Header.Set("Range", "bytes=0-3")
	rec := httptest.NewRecorder()
	if err := Proxy(rec, req, &StreamInfo{URL: upstream.URL, ContentType: "audio/mp4"}); err != nil {
		t.Fatalf("proxy: %v", err)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d", rec.Code)
	}
	if string(body) != "abcd" {
		t.Fatalf("body = %q", body)
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "audio") {
		t.Fatalf("content-type = %q", rec.Header().Get("Content-Type"))
	}
	if rec.Header().Get("Content-Range") == "" {
		t.Fatal("missing Content-Range")
	}
}

func TestProxyRejectsExpiredUpstream(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("<html>expired</html>"))
	}))
	defer upstream.Close()

	host := strings.TrimPrefix(strings.TrimPrefix(upstream.URL, "http://"), "https://")
	if idx := strings.Index(host, "/"); idx >= 0 {
		host = host[:idx]
	}
	if idx := strings.Index(host, ":"); idx >= 0 {
		host = host[:idx]
	}
	AllowHostsForTest(host)
	defer AllowHostsForTest()

	req := httptest.NewRequest(http.MethodGet, "/audio", nil)
	rec := httptest.NewRecorder()
	err := Proxy(rec, req, &StreamInfo{URL: upstream.URL, ContentType: "audio/mp4", DurationMs: 180000, Ext: "m4a"})
	if err == nil {
		t.Fatal("expected expired upstream to fail before writing audio")
	}
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Fatalf("client should not receive the HTML error page, status=%d body=%q", rec.Code, rec.Body.String())
	}
}

func TestProxyWritesDurationMetadata(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/mp4")
		w.Header().Set("Content-Length", "4")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("abcd"))
	}))
	defer upstream.Close()

	host := strings.TrimPrefix(strings.TrimPrefix(upstream.URL, "http://"), "https://")
	if idx := strings.Index(host, "/"); idx >= 0 {
		host = host[:idx]
	}
	if idx := strings.Index(host, ":"); idx >= 0 {
		host = host[:idx]
	}
	AllowHostsForTest(host)
	defer AllowHostsForTest()

	req := httptest.NewRequest(http.MethodGet, "/audio", nil)
	rec := httptest.NewRecorder()
	if err := Proxy(rec, req, &StreamInfo{
		URL:         upstream.URL,
		ContentType: "audio/mp4",
		DurationMs:  181000,
		Ext:         "m4a",
	}); err != nil {
		t.Fatalf("proxy: %v", err)
	}
	if rec.Header().Get(HeaderDurationMs) != "181000" {
		t.Fatalf("duration header = %q", rec.Header().Get(HeaderDurationMs))
	}
	if rec.Header().Get(HeaderExt) != "m4a" {
		t.Fatalf("ext header = %q", rec.Header().Get(HeaderExt))
	}
}

func TestParseBytesRange(t *testing.T) {
	span, ok := parseBytesRange("")
	if ok {
		t.Fatal("empty range should be absent")
	}
	span, ok = parseBytesRange("bytes=0-1")
	if !ok || span.start != 0 || !span.hasEnd || span.end != 1 {
		t.Fatalf("closed: %+v ok=%v", span, ok)
	}
	span, ok = parseBytesRange("bytes=0-")
	if !ok || span.start != 0 || span.hasEnd {
		t.Fatalf("open: %+v ok=%v", span, ok)
	}
	span, ok = parseBytesRange("bytes=1000-2000")
	if !ok || span.start != 1000 || span.end != 2000 {
		t.Fatalf("mid: %+v ok=%v", span, ok)
	}
}

func TestProxyStitchesClosedChunksWhenClientOmitsRange(t *testing.T) {
	payload := []byte("abcdefghijklmnopqrstuvwxyz")
	prev := upstreamChunkSize
	upstreamChunkSize = 8
	t.Cleanup(func() { upstreamChunkSize = prev })

	var sawOpenEnded bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		span, ok := parseBytesRange(r.Header.Get("Range"))
		if !ok || !span.hasEnd {
			sawOpenEnded = true
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusForbidden)
			return
		}
		total := int64(len(payload))
		if span.end >= total {
			span.end = total - 1
		}
		if span.start > span.end {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			return
		}
		chunk := payload[span.start : span.end+1]
		w.Header().Set("Content-Type", "audio/mp4")
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", span.start, span.end, total))
		w.Header().Set("Content-Length", strconv.Itoa(len(chunk)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(chunk)
	}))
	defer upstream.Close()
	allowTestHost(t, upstream.URL)

	req := httptest.NewRequest(http.MethodGet, "/audio", nil)
	rec := httptest.NewRecorder()
	if err := Proxy(rec, req, &StreamInfo{URL: upstream.URL, ContentType: "audio/mp4"}); err != nil {
		t.Fatalf("proxy: %v", err)
	}
	if sawOpenEnded {
		t.Fatal("proxy sent an open-ended Range to googlevideo-like upstream")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != string(payload) {
		t.Fatalf("body = %q", body)
	}
	if rec.Header().Get("Content-Length") != strconv.Itoa(len(payload)) {
		t.Fatalf("content-length = %q", rec.Header().Get("Content-Length"))
	}

	req = httptest.NewRequest(http.MethodGet, "/audio", nil)
	req.Header.Set("Range", "bytes=0-")
	rec = httptest.NewRecorder()
	if err := Proxy(rec, req, &StreamInfo{URL: upstream.URL, ContentType: "audio/mp4"}); err != nil {
		t.Fatalf("open-ended proxy: %v", err)
	}
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("open-ended status = %d", rec.Code)
	}
	body, _ = io.ReadAll(rec.Result().Body)
	if string(body) != string(payload) {
		t.Fatalf("open-ended body = %q", body)
	}
	if rec.Header().Get("Content-Range") != fmt.Sprintf("bytes 0-%d/%d", len(payload)-1, len(payload)) {
		t.Fatalf("content-range = %q", rec.Header().Get("Content-Range"))
	}
}

func allowTestHost(t *testing.T, rawURL string) {
	t.Helper()
	host := strings.TrimPrefix(strings.TrimPrefix(rawURL, "http://"), "https://")
	if idx := strings.Index(host, "/"); idx >= 0 {
		host = host[:idx]
	}
	if idx := strings.Index(host, ":"); idx >= 0 {
		host = host[:idx]
	}
	AllowHostsForTest(host)
	t.Cleanup(func() { AllowHostsForTest() })
}
