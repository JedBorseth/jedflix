package openlibrary

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestShrinkToTenPercentPixels(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 100, 200))
	for y := 0; y < 200; y++ {
		for x := 0; x < 100; x++ {
			src.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, src, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode source: %v", err)
	}

	out, err := shrinkToTenPercentPixels(buf.Bytes())
	if err != nil {
		t.Fatalf("shrink: %v", err)
	}

	decoded, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode shrunk: %v", err)
	}
	bounds := decoded.Bounds()
	gotPixels := bounds.Dx() * bounds.Dy()
	wantPixels := int(math.Round(100*pixelScaleFactor)) * int(math.Round(200*pixelScaleFactor))
	if gotPixels != wantPixels {
		t.Fatalf("pixel count = %d, want %d (%dx%d)", gotPixels, wantPixels, bounds.Dx(), bounds.Dy())
	}
	ratio := float64(gotPixels) / float64(100*200)
	if ratio < 0.09 || ratio > 0.11 {
		t.Fatalf("pixel ratio = %.4f, want ~0.10", ratio)
	}
}

func TestImageCacheTTLAndEviction(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	client := NewClient(config.Config{OpenLibraryCacheTTL: time.Hour})
	client.now = func() time.Time { return now }

	client.storeImage("a", []byte("one"), "image/jpeg")
	client.storeImage("b", []byte("two"), "image/jpeg")
	client.storeImage("c", []byte("three"), "image/jpeg")

	count := 0
	client.imageCache.Range(func(_, _ any) bool {
		count++
		return true
	})
	if count != 3 {
		t.Fatalf("expected 3 cached images, got %d", count)
	}

	// Expire all entries then store one fresh — expired should be evicted.
	now = now.Add(2 * time.Hour)
	client.storeImage("fresh", []byte("fresh"), "image/jpeg")

	if _, ok := client.imageCache.Load("a"); ok {
		t.Fatal("expected expired entry a to be evicted")
	}
	if _, ok := client.imageCache.Load("fresh"); !ok {
		t.Fatal("expected fresh entry to remain")
	}
}

func TestCoverAndAuthorProxyURLs(t *testing.T) {
	client := NewClient(config.Config{
		OpenLibraryCoverPublicBase: "/backend/api/v1/openlibrary/covers",
	})

	if got := client.coverURL(0); got != fallbackCover {
		t.Fatalf("coverURL(0) = %q", got)
	}
	if got := client.coverURL(12345); got != "/backend/api/v1/openlibrary/covers/b/id/12345.jpg" {
		t.Fatalf("coverURL = %q", got)
	}
	if got := client.coverFullURL(12345); got != "https://covers.openlibrary.org/b/id/12345-L.jpg" {
		t.Fatalf("coverFullURL = %q", got)
	}
	if got := client.authorPhotoURL("OL23919A", 99); got != "/backend/api/v1/openlibrary/covers/a/id/99.jpg" {
		t.Fatalf("authorPhotoURL with id = %q", got)
	}
	if got := client.authorPhotoFullURL("OL23919A", 99); got != "https://covers.openlibrary.org/a/id/99-M.jpg" {
		t.Fatalf("authorPhotoFullURL = %q", got)
	}
	if got := client.authorPhotoURL("OL23919A", 0); got != "/backend/api/v1/openlibrary/covers/a/olid/OL23919A.jpg" {
		t.Fatalf("authorPhotoURL with olid = %q", got)
	}
}

func TestCoverIDFromProxyURL(t *testing.T) {
	base := "/backend/api/v1/openlibrary/covers"
	if got := coverIDFromProxyURL(base+"/b/id/42.jpg", base); got != 42 {
		t.Fatalf("coverIDFromProxyURL = %d", got)
	}
	if got := coverIDFromProxyURL(fallbackCover, base); got != 0 {
		t.Fatalf("fallback should not parse, got %d", got)
	}
}

func TestImageCacheMaxSizeEviction(t *testing.T) {
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	client := NewClient(config.Config{OpenLibraryCacheTTL: time.Hour})
	client.now = func() time.Time { return now }

	for i := 0; i < 5; i++ {
		client.storeImage(string(rune('a'+i)), []byte{byte(i)}, "image/jpeg")
		now = now.Add(time.Second)
	}
	client.evictExpiredImages(time.Hour, 3)

	count := 0
	client.imageCache.Range(func(_, _ any) bool {
		count++
		return true
	})
	if count != 3 {
		t.Fatalf("expected max size 3, got %d", count)
	}
	if _, ok := client.imageCache.Load("a"); ok {
		t.Fatal("oldest entry a should be evicted")
	}
	if _, ok := client.imageCache.Load("b"); ok {
		t.Fatal("second-oldest entry b should be evicted")
	}
	if _, ok := client.imageCache.Load("e"); !ok {
		t.Fatal("newest entry e should remain")
	}
}
