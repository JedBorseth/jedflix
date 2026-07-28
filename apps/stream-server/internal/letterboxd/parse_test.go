package letterboxd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNormalizeUsername(t *testing.T) {
	ok, err := NormalizeUsername("  Dave_99  ")
	if err != nil {
		t.Fatalf("expected valid username, got %v", err)
	}
	if ok != "dave_99" {
		t.Fatalf("got %q", ok)
	}

	for _, bad := range []string{"", "../evil", "has space", "a/b", strings.Repeat("x", 40)} {
		if _, err := NormalizeUsername(bad); err == nil {
			t.Fatalf("expected invalid for %q", bad)
		}
	}
}

func TestParseDiaryRSS(t *testing.T) {
	path := filepath.Join("testdata", "diary_rss.xml")
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	displayName, films, err := ParseDiaryRSS(f)
	if err != nil {
		t.Fatal(err)
	}
	if displayName != "Dave Vis" {
		t.Fatalf("displayName=%q", displayName)
	}
	if len(films) < 1 {
		t.Fatal("expected films")
	}
	first := films[0]
	if first.Title == "" {
		t.Fatal("expected title")
	}
	if first.TmdbID == nil {
		t.Fatalf("expected tmdb id on %#v", first)
	}
	if first.WatchedDate == "" {
		t.Fatalf("expected watched date on %#v", first)
	}
	if first.Slug == "" {
		t.Fatalf("expected slug on %#v", first)
	}
}

func TestParseEmptyDiaryRSS(t *testing.T) {
	path := filepath.Join("testdata", "empty_rss.xml")
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	displayName, films, err := ParseDiaryRSS(f)
	if err != nil {
		t.Fatal(err)
	}
	if displayName != "Empty User" {
		t.Fatalf("displayName=%q", displayName)
	}
	if len(films) != 0 {
		t.Fatalf("expected no films, got %d", len(films))
	}
}

func TestCacheTTL(t *testing.T) {
	cache := NewCache(time.Hour)
	now := time.UnixMilli(1_700_000_000_000)
	cache.now = func() time.Time { return now }

	cache.Set(cacheEntry{
		Username: "dave",
		Films:    []FilmEntry{{Title: "Toy Story"}},
		CachedAt: now.UnixMilli(),
	})
	if _, ok := cache.Get("dave"); !ok {
		t.Fatal("expected cache hit")
	}

	cache.now = func() time.Time { return now.Add(2 * time.Hour) }
	if _, ok := cache.Get("dave"); ok {
		t.Fatal("expected cache miss after TTL")
	}
}
