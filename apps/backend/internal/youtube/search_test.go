package youtube

import "testing"

func TestParseCatalogTitleArtistDashSong(t *testing.T) {
	artist, name := parseCatalogTitle("Radiohead - Karma Police (Official Audio)", "Radiohead")
	if artist != "Radiohead" || name != "Karma Police" {
		t.Fatalf("got artist=%q name=%q", artist, name)
	}
}

func TestParseCatalogTitleTopicChannel(t *testing.T) {
	artist, name := parseCatalogTitle("Karma Police", "Radiohead - Topic")
	if artist != "Radiohead" || name != "Karma Police" {
		t.Fatalf("got artist=%q name=%q", artist, name)
	}
}

func TestMapCatalogEntryFiltersTrailer(t *testing.T) {
	_, ok := mapCatalogEntry(catalogSearchEntry{
		ID:       "abc123XYZ",
		Title:    "Movie Official Trailer",
		Duration: 120,
		Uploader: "Studio",
	})
	if ok {
		t.Fatal("expected trailer filtered")
	}
}

func TestMapCatalogEntryBuildsTrack(t *testing.T) {
	track, ok := mapCatalogEntry(catalogSearchEntry{
		ID:       "dQw4w9WgXcQ",
		Title:    "Artist Name - Obscure Song (Official Audio)",
		Duration: 210.5,
		Uploader: "Artist Name - Topic",
		Thumbnails: []struct {
			URL    string `json:"url"`
			Height int    `json:"height"`
			Width  int    `json:"width"`
		}{
			{URL: "https://img/low.jpg", Height: 90, Width: 120},
			{URL: "https://img/hi.jpg", Height: 720, Width: 1280},
		},
	})
	if !ok {
		t.Fatal("expected mapped track")
	}
	if track.ID != "yt:dQw4w9WgXcQ" || track.VideoID != "dQw4w9WgXcQ" {
		t.Fatalf("unexpected ids: %+v", track)
	}
	if track.Name != "Obscure Song" || track.Artists[0] != "Artist Name" {
		t.Fatalf("unexpected names: %+v", track)
	}
	if track.DurationMs != 210500 {
		t.Fatalf("duration %d", track.DurationMs)
	}
	if track.ImageURL != "https://img/hi.jpg" {
		t.Fatalf("image %q", track.ImageURL)
	}
	if track.Source != "youtube" {
		t.Fatalf("source %q", track.Source)
	}
}

func TestExtractVideoID(t *testing.T) {
	cases := map[string]string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ": "dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ?t=30":           "dQw4w9WgXcQ",
		"https://www.youtube.com/shorts/dQw4w9WgXcQ":  "dQw4w9WgXcQ",
		"dQw4w9WgXcQ": "dQw4w9WgXcQ",
		"":            "",
	}
	for in, want := range cases {
		if got := extractVideoID(in); got != want {
			t.Fatalf("extractVideoID(%q)=%q want %q", in, got, want)
		}
	}
}
