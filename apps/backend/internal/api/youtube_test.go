package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/youtube"
)

func TestYouTubeAudioDoesNotRetryAfterPartialResponse(t *testing.T) {
	var upstreamRequests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamRequests.Add(1)
		if r.Header.Get("Range") != "bytes=0-5" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "audio/mp4")
		w.Header().Set("Content-Range", "bytes 0-2/6")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("abc"))
	}))
	defer upstream.Close()
	youtube.AllowHostsForTest("127.0.0.1")
	t.Cleanup(func() { youtube.AllowHostsForTest() })

	payload, err := json.Marshal(map[string]string{"url": upstream.URL, "ext": "m4a"})
	if err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	script := "#!/bin/sh\nprintf '%s\\n' '" + string(payload) + "'\n"
	if err := os.WriteFile(filepath.Join(bin, "yt-dlp"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)

	srv := NewServer(config.Config{}, nil, nil, nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/youtube/audio?videoId=Abcdef12345", nil)
	req.Header.Set("Range", "bytes=0-5")
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "abc" {
		t.Fatalf("response was changed after streaming started: %d %q", rec.Code, rec.Body.String())
	}
	if got := upstreamRequests.Load(); got != 2 {
		t.Fatalf("got %d upstream requests, want two chunks without a retry", got)
	}
}
