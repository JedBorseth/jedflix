package musicbrainz

import (
	"bytes"
	"context"
	"errors"
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
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
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

func TestArtworkRateLimitDoesNotMarkMissing(t *testing.T) {
	dir := t.TempDir()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer upstream.Close()

	client := NewClient(config.Config{
		CoverArtArchiveBaseURL: upstream.URL,
		MusicArtworkPath:       dir,
		MusicCatalogCacheTTL:   time.Hour,
	})
	client.http = upstream.Client()

	mbid := "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
	_, _, err := client.GetReleaseGroupCover(context.Background(), mbid)
	if !errors.Is(err, musiccatalog.ErrRateLimited) {
		t.Fatalf("err=%v want rate limited", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "missing", mbid)); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("rate-limited cover should not create missing marker: %v", statErr)
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

func TestArtistCoverURLUsesPublicProxy(t *testing.T) {
	client := NewClient(config.Config{
		MusicCoverPublicBase: "/backend/api/v1/music/covers",
	})
	got := client.artistCoverURL("a74b1b7f-71a5-4011-9441-d0b5e4122711")
	want := "/backend/api/v1/music/covers/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711.jpg"
	if got != want {
		t.Fatalf("artistCoverURL=%q want %q", got, want)
	}
}

func TestWikimediaFilePath(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{
			"https://commons.wikimedia.org/wiki/File:Radiohead.jpg",
			"https://commons.wikimedia.org/wiki/Special:FilePath/Radiohead.jpg?width=500",
		},
		{
			"https://commons.wikimedia.org/wiki/Special:FilePath/Radiohead.jpg",
			"https://commons.wikimedia.org/wiki/Special:FilePath/Radiohead.jpg?width=500",
		},
		{
			"https://upload.wikimedia.org/wikipedia/commons/a/ab/Radiohead.jpg",
			"https://upload.wikimedia.org/wikipedia/commons/a/ab/Radiohead.jpg",
		},
		{
			"https://example.com/photo.jpg",
			"https://example.com/photo.jpg",
		},
	}
	for _, tc := range cases {
		got := wikimediaFilePath(tc.in)
		if got != tc.want {
			t.Fatalf("wikimediaFilePath(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestWithArtistImageURLsUsesProxy(t *testing.T) {
	client := NewClient(config.Config{
		MusicCoverPublicBase: "/backend/api/v1/music/covers",
	})
	artists := client.withArtistImageURLs([]musiccatalog.Artist{
		{ID: "a74b1b7f-71a5-4011-9441-d0b5e4122711", Name: "Radiohead"},
	})
	if len(artists) != 1 {
		t.Fatalf("len=%d", len(artists))
	}
	want := "/backend/api/v1/music/covers/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711.jpg"
	if artists[0].ImageURL != want {
		t.Fatalf("imageUrl=%q want %q", artists[0].ImageURL, want)
	}
}

func TestWithTrackCoverURLsUsesAlbumProxy(t *testing.T) {
	client := NewClient(config.Config{
		MusicCoverPublicBase: "/backend/api/v1/music/covers",
	})
	tracks := client.withTrackCoverURLs(context.Background(), []musiccatalog.TopTrack{
		{ID: "rec-1", Name: "Karma Police", AlbumID: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"},
		{ID: "rec-2", Name: "No Album"},
	})
	if tracks[0].ImageURL != "/backend/api/v1/music/covers/release-group/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d.jpg" {
		t.Fatalf("track 0 image=%q", tracks[0].ImageURL)
	}
	if tracks[1].ImageURL != fallbackImage {
		t.Fatalf("track 1 image=%q", tracks[1].ImageURL)
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
