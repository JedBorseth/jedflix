package youtube

import (
	"testing"
)

func TestBuildSearchQuery(t *testing.T) {
	got := buildSearchQuery(Request{Artist: "Radiohead", Title: "Karma Police", Album: "OK Computer"})
	want := "Radiohead Karma Police official audio"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestPickBestEntryPrefersOfficialAudioOverMusicVideo(t *testing.T) {
	req := Request{
		Artist:     "Radiohead",
		Title:      "Karma Police",
		Album:      "OK Computer",
		DurationMs: 260_000,
	}
	entries := []searchEntry{
		{ID: "1", Title: "Karma Police - Radiohead (Official Music Video)", Duration: 320, ViewCount: 90_000_000, Uploader: "Radiohead"},
		{ID: "2", Title: "Karma Police - Radiohead (Official Audio)", Duration: 262, ViewCount: 50_000_000, Uploader: "Radiohead"},
		{ID: "3", Title: "Karma Police cover", Duration: 250, ViewCount: 1000},
	}
	best := pickBestEntry(entries, req)
	if best == nil || best.ID != "2" {
		t.Fatalf("expected official audio id=2, got %+v", best)
	}
}

func TestPickBestEntryUsesDurationMatch(t *testing.T) {
	req := Request{Artist: "Artist", Title: "Song", DurationMs: 180_000}
	entries := []searchEntry{
		{ID: "mv", Title: "Song Official Audio", Duration: 240, ViewCount: 1_000_000},
		{ID: "ok", Title: "Song Official Audio", Duration: 181, ViewCount: 100_000},
	}
	best := pickBestEntry(entries, req)
	if best == nil || best.ID != "ok" {
		t.Fatalf("expected duration match id=ok, got %+v", best)
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
	req := Request{DurationMs: 200_000}
	if !isLikelyLiveOrNonMusic(&searchEntry{Title: "Official Trailer", Duration: 120}, req) {
		t.Fatal("expected trailer filtered")
	}
	if !isLikelyLiveOrNonMusic(&searchEntry{Title: "Song Official Music Video", Duration: 280}, req) {
		t.Fatal("expected long music video filtered when duration known")
	}
	if isLikelyLiveOrNonMusic(&searchEntry{Title: "Song Name Official Audio", Duration: 210}, req) {
		t.Fatal("normal song should pass")
	}
}
