package musicbrainz

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestArtworkDiskCacheDedupAndMissing(t *testing.T) {
	dir := t.TempDir()
	cfg := config.Config{
		MusicBrainzAPIBaseURL:  "http://example.invalid",
		CoverArtArchiveBaseURL: "https://coverartarchive.org",
		MusicArtworkPath:       dir,
		MusicCoverPublicBase:   "/backend/api/v1/music/covers",
		MusicCatalogCacheTTL:   time.Hour,
	}
	client := NewClient(cfg)
	client.now = func() time.Time { return time.Unix(1_700_000_000, 0) }

	// Tiny valid JPEG (1x1).
	jpegBytes := mustTinyJPEG(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(jpegBytes)
	}))
	defer upstream.Close()
	client.coverBase = upstream.URL
	client.http = upstream.Client()

	mbid := "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
	data, contentType, err := client.GetReleaseGroupCover(context.Background(), mbid)
	if err != nil {
		t.Fatalf("first fetch: %v", err)
	}
	if contentType != "image/jpeg" || len(data) == 0 {
		t.Fatalf("unexpected image payload type=%s len=%d", contentType, len(data))
	}
	if _, err := os.Stat(filepath.Join(dir, "by-mbid", mbid+".jpg")); err != nil {
		t.Fatalf("expected by-mbid file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "by-mbid", mbid+".jpg.hash")); err != nil {
		t.Fatalf("expected hash pointer: %v", err)
	}

	// Second mbid with identical bytes should reuse by-hash content.
	mbid2 := "a74b1b7f-71a5-4011-9441-d0b5e4122711"
	if _, _, err := client.GetReleaseGroupCover(context.Background(), mbid2); err != nil {
		t.Fatalf("second fetch: %v", err)
	}
	hashEntries := 0
	_ = filepath.Walk(filepath.Join(dir, "by-hash"), func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && filepath.Ext(path) == ".jpg" {
			hashEntries++
		}
		return nil
	})
	if hashEntries != 1 {
		t.Fatalf("expected 1 deduped hash file, got %d", hashEntries)
	}

	// Missing artwork marker.
	missingServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer missingServer.Close()
	client.coverBase = missingServer.URL
	client.http = missingServer.Client()
	missingID := "00000000-0000-0000-0000-000000000001"
	if _, _, err := client.GetReleaseGroupCover(context.Background(), missingID); err == nil {
		t.Fatal("expected not found for missing cover")
	}
	if _, err := os.Stat(filepath.Join(dir, "missing", missingID)); err != nil {
		t.Fatalf("expected missing marker: %v", err)
	}
}

func TestCoverURLUsesPublicProxy(t *testing.T) {
	client := NewClient(config.Config{
		MusicCoverPublicBase: "/backend/api/v1/music/covers",
	})
	got := client.coverURL("b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d")
	want := "/backend/api/v1/music/covers/release-group/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d.jpg"
	if got != want {
		t.Fatalf("coverURL=%q want %q", got, want)
	}
}

func mustTinyJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 40, B: 40, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}
