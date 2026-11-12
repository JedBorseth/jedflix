package youtube

import (
	"strings"
	"testing"
)

func TestMusicSongsSearchURL(t *testing.T) {
	got := musicSongsSearchURL(Request{Artist: "The Weeknd", Title: "Blinding Lights"})
	want := "https://music.youtube.com/search?q=The%20Weeknd%20Blinding%20Lights#songs"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestPickSongCandidatesPrefersExactTitleAndSkipsOtherSongs(t *testing.T) {
	req := Request{Artist: "Radiohead", Title: "Karma Police"}
	entries := []searchEntry{
		{ID: "remasterXYZ1", Title: "Karma Police (Remastered)"},
		{ID: "exactXYZ0001", Title: "Karma Police"},
		{ID: "otherSong001", Title: "Paranoid Android"},
		{ID: "lullabyXYZ01", Title: `Karma Police (made famous by "Radiohead")`},
		{ID: "remixXYZ0001", Title: "Karma Police (Remix)"},
		{ID: "exactXYZ0001", Title: "Karma Police"},
	}
	got := pickSongCandidates(entries, req)
	ids := make([]string, 0, len(got))
	for _, entry := range got {
		ids = append(ids, entry.ID)
	}
	if strings.Join(ids, ",") != "exactXYZ0001,remasterXYZ1" {
		t.Fatalf("unexpected candidates %v", ids)
	}
}

func TestPickSongCandidatesKeepsRequestedVersion(t *testing.T) {
	req := Request{Artist: "Artist", Title: "Song (Acoustic)"}
	got := pickSongCandidates([]searchEntry{{ID: "acousticXYZ1", Title: "Song (Acoustic)"}}, req)
	if len(got) != 1 {
		t.Fatalf("expected requested acoustic version kept, got %v", got)
	}
}

func TestPickSongCandidatesSkipsLiveUnlessRequested(t *testing.T) {
	entries := []searchEntry{{ID: "liveXYZ00001", Title: "Bone Machine (Live)"}}
	if got := pickSongCandidates(entries, Request{Artist: "Pixies", Title: "Bone Machine"}); len(got) != 0 {
		t.Fatalf("expected live version skipped, got %v", got)
	}
	if got := pickSongCandidates(entries, Request{Artist: "Pixies", Title: "Bone Machine (Live)"}); len(got) != 1 {
		t.Fatalf("expected requested live version kept, got %v", got)
	}
}

func TestSongTitleTier(t *testing.T) {
	cases := []struct {
		candidate, want string
		tier            int
	}{
		{"Blinding Lights", "Blinding Lights", 0},
		{"Karma Police (Remastered)", "Karma Police", 1},
		{"Here Comes the Sun", "Here Comes the Sun - Remastered 2009", 1},
		{"Old Town Road (feat. Billy Ray Cyrus)", "Old Town Road", 1},
		{"Flashing Lights", "Blinding Lights", -1},
	}
	for _, tc := range cases {
		if got := songTitleTier(tc.candidate, tc.want); got != tc.tier {
			t.Errorf("songTitleTier(%q, %q) = %d want %d", tc.candidate, tc.want, got, tc.tier)
		}
	}
}

func TestSongMatchesRequestRejectsCoversAndWrongLength(t *testing.T) {
	req := Request{Artist: "Radiohead", Title: "Karma Police", DurationMs: 264_000}
	if !songMatchesRequest(songMeta{Artists: []string{"Radiohead"}, Duration: 261}, req) {
		t.Fatal("expected the real recording to match")
	}
	if songMatchesRequest(songMeta{Artists: []string{"Grifon"}, Channel: "Release - Topic", Duration: 262}, req) {
		t.Fatal("expected a cover by another artist rejected")
	}
	if songMatchesRequest(songMeta{Artists: []string{"Radiohead"}, Duration: 330}, req) {
		t.Fatal("expected a much longer recording rejected")
	}
	if !songMatchesRequest(songMeta{Channel: "Radiohead - Topic", Duration: 264}, Request{Artist: "Radiohead", Title: "Karma Police"}) {
		t.Fatal("expected Topic channel artist to match")
	}
	if !songMatchesRequest(songMeta{Artist: "Lil Nas X, Billy Ray Cyrus"}, Request{Artist: "Billy Ray Cyrus", Title: "Old Town Road"}) {
		t.Fatal("expected a featured artist to match")
	}
}
