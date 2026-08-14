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

func TestIsBrowserSafeAudio(t *testing.T) {
	if !isBrowserSafeAudio("m4a", "mp4a.40.2") {
		t.Fatal("m4a should be safe")
	}
	if !isBrowserSafeAudio("mp3", "mp3") {
		t.Fatal("mp3 should be safe")
	}
	if isBrowserSafeAudio("webm", "opus") {
		t.Fatal("webm/opus is not Safari-safe")
	}
	if isBrowserSafeAudio("ogg", "vorbis") {
		t.Fatal("ogg/vorbis is not Safari-safe")
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
	if !isLikelyLiveOrNonMusic(&searchEntry{Title: "Bone Machine (Live at Brixton)", Duration: 210}, req) {
		t.Fatal("expected concert upload filtered")
	}
	if isLikelyLiveOrNonMusic(&searchEntry{Title: "Live and Let Die Official Audio", Duration: 190}, Request{
		Title:      "Live and Let Die",
		DurationMs: 190_000,
	}) {
		t.Fatal("studio song with Live in the title should pass")
	}
}

func TestSanitizeResolveRequestDropsLiveAlbumHints(t *testing.T) {
	got := sanitizeResolveRequest(Request{
		Artist:     "Pixies",
		Title:      "Bone Machine",
		Album:      "2009-10-06/09: Doolittle Live: Brixton Academy, London, UK",
		DurationMs: 340_000,
	})
	if got.Album != "" || got.DurationMs != 0 {
		t.Fatalf("expected live album/duration stripped, got %+v", got)
	}

	kept := sanitizeResolveRequest(Request{
		Artist:     "Pixies",
		Title:      "Bone Machine",
		Album:      "Doolittle",
		DurationMs: 183_000,
	})
	if kept.Album != "Doolittle" || kept.DurationMs != 183_000 {
		t.Fatalf("expected studio album kept, got %+v", kept)
	}
}

func TestPickBestEntryPrefersStudioOverLiveConcert(t *testing.T) {
	req := Request{
		Artist:     "Pixies",
		Title:      "Bone Machine",
		Album:      "2009-10-06/09: Doolittle Live: Brixton Academy, London, UK",
		DurationMs: 340_000,
	}
	req = sanitizeResolveRequest(req)
	entries := []searchEntry{
		{ID: "live", Title: "Pixies - Bone Machine (Live at Brixton Academy)", Duration: 340, ViewCount: 80_000},
		{ID: "studio", Title: "Pixies - Bone Machine (Official Audio)", Duration: 183, ViewCount: 5_000_000, Uploader: "Pixies - Topic"},
	}
	best := pickBestEntry(entries, req)
	if best == nil || best.ID != "studio" {
		t.Fatalf("expected studio official audio, got %+v", best)
	}
}

func TestPickBestEntryDoesNotFallBackToLiveConcert(t *testing.T) {
	req := Request{Artist: "The White Stripes", Title: "Seven Nation Army"}
	entries := []searchEntry{
		{ID: "live", Title: "Seven Nation Army - Live at the Masonic Temple", Duration: 488, ViewCount: 1_000_000},
	}
	best := pickBestEntry(entries, req)
	if best != nil {
		t.Fatalf("expected no live fallback, got %+v", best)
	}
}
