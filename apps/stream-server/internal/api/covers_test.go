package api

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
	"github.com/jedborseth/jeds-movies/stream-server/internal/openlibrary"
)

func TestOpenLibraryCoverProxyServesShrunkJPEG(t *testing.T) {
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path != "/b/id/99-L.jpg" {
			http.NotFound(w, r)
			return
		}
		src := image.NewRGBA(image.Rect(0, 0, 100, 100))
		for y := 0; y < 100; y++ {
			for x := 0; x < 100; x++ {
				src.Set(x, y, color.RGBA{R: 200, G: 100, B: 50, A: 255})
			}
		}
		w.Header().Set("Content-Type", "image/jpeg")
		_ = jpeg.Encode(w, src, &jpeg.Options{Quality: 90})
	}))
	defer upstream.Close()

	cfg := config.Config{
		OpenLibraryCacheTTL:        time.Hour,
		OpenLibraryCoverPublicBase: "/stream-api/api/v1/openlibrary/covers",
		OpenLibraryCoversBaseURL:   upstream.URL,
		CORSOrigins:                []string{"http://localhost:5173"},
	}
	client := openlibrary.NewClient(cfg)
	server := NewServer(cfg, nil, nil, client, nil)
	router := server.Router()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/openlibrary/covers/b/id/99.jpg", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("content-type = %q", ct)
	}

	img, _, err := image.Decode(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("decode response: %v", err)
	}
	pixels := img.Bounds().Dx() * img.Bounds().Dy()
	if pixels != 32*32 { // round(100 * sqrt(0.1)) == 32
		t.Fatalf("pixels = %d (%dx%d), want 1024", pixels, img.Bounds().Dx(), img.Bounds().Dy())
	}

	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusOK {
		t.Fatalf("cached status = %d", rec2.Code)
	}
	if hits.Load() != 1 {
		t.Fatalf("expected 1 upstream hit, got %d", hits.Load())
	}
}
