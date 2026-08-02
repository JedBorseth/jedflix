package youtube

import (
	"testing"
)

func TestBuildSearchQuery(t *testing.T) {
	got := buildSearchQuery(Request{Artist: "Radiohead", Title: "Karma Police", Album: "OK Computer"})
	want := "Radiohead Karma Police OK Computer"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestPickBestEntryPrefersTitleArtistMatch(t *testing.T) {
	req := Request{Artist: "Radiohead", Title: "Karma Police", Album: "OK Computer"}
	entries := []searchEntry{
		{ID: "1", Title: "Random live jam hour long stream", Duration: 3600, ViewCount: 9_000_000},
		{ID: "2", Title: "Karma Police - Radiohead (Official Audio)", Duration: 260, ViewCount: 50_000_000, Uploader: "Radiohead"},
		{ID: "3", Title: "Karma Police cover", Duration: 250, ViewCount: 1000},
	}
	best := pickBestEntry(entries, req)
	if best == nil || best.ID != "2" {
		t.Fatalf("expected official audio id=2, got %+v", best)
	}
}

func TestContentTypeFor(t *testing.T) {
	if got := contentTypeFor("m4a", "mp4a.40.2"); got != "audio/mp4" {
		t.Fatalf("m4a => %s", got)
	}
	if got := contentTypeFor("webm", "opus"); got != "audio/webm" {
		t.Fatalf("webm => %s", got)
	}
}

func TestNormalizeText(t *testing.T) {
	got := normalizeText("  Karma-Police (Official Audio)! ")
	if got != "karma police official audio" {
		t.Fatalf("got %q", got)
	}
}

func TestIsLikelyLiveOrNonMusic(t *testing.T) {
	if !isLikelyLiveOrNonMusic(&searchEntry{Title: "Official Trailer", Duration: 120}) {
		t.Fatal("expected trailer filtered")
	}
	if isLikelyLiveOrNonMusic(&searchEntry{Title: "Song Name", Duration: 210}) {
		t.Fatal("normal song should pass")
	}
}
