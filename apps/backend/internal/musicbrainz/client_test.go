package musicbrainz

import (
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz/local"
)

func TestNormalizeMBID(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"a74b1b7f-71a5-4011-9441-d0b5e4122711", "a74b1b7f-71a5-4011-9441-d0b5e4122711"},
		{"A74B1B7F-71A5-4011-9441-D0B5E4122711", "a74b1b7f-71a5-4011-9441-d0b5e4122711"},
		{"https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711", "a74b1b7f-71a5-4011-9441-d0b5e4122711"},
		{"https://musicbrainz.org/release-group/a74b1b7f-71a5-4011-9441-d0b5e4122711?foo=1", "a74b1b7f-71a5-4011-9441-d0b5e4122711"},
		{"4aawyAB9vmqN3uQ7FjRGTy", ""},
		{"", ""},
	}
	for _, tc := range cases {
		got := NormalizeMBID(tc.in)
		if got != tc.want {
			t.Fatalf("NormalizeMBID(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestShouldRerankSkipsShortAndExactMatches(t *testing.T) {
	hits := []local.SearchHit{
		{EntityType: "artist", MBID: "1", Name: "Drake", Fused: 2},
		{EntityType: "track", MBID: "2", Name: "Hotline Bling", Fused: 1},
	}
	if shouldRerank("hi", hits) {
		t.Fatal("short queries should skip rerank")
	}
	if shouldRerank("drake", hits) {
		t.Fatal("exact first-hit name should skip rerank")
	}
	if !shouldRerank("hotline", hits) {
		t.Fatal("ambiguous longer queries should rerank")
	}
	if shouldRerank("radiohead", hits[:1]) {
		t.Fatal("single hit should skip rerank")
	}
}
