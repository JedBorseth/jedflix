package resolver

import (
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/search"
)

func TestDedupeReleasesKeepsFirstPerTorrentFile(t *testing.T) {
	zero, one := 0, 1
	got := dedupeReleases([]search.Release{
		{Title: "best", InfoHash: "a", FileIdx: &zero},
		{Title: "dup", InfoHash: "a", FileIdx: &zero},
		{Title: "other file", InfoHash: "a", FileIdx: &one},
		{Title: "whole torrent", InfoHash: "a"},
		{Title: "whole torrent dup", InfoHash: "a"},
	})
	var titles []string
	for _, release := range got {
		titles = append(titles, release.Title)
	}
	want := []string{"best", "other file", "whole torrent"}
	if len(titles) != len(want) {
		t.Fatalf("got %v, want %v", titles, want)
	}
	for i := range want {
		if titles[i] != want[i] {
			t.Fatalf("got %v, want %v", titles, want)
		}
	}
}
