package youtube

import (
	"io"
	"net/http"
	"net/http/httptest"
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
