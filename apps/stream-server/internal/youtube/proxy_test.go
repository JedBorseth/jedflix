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
