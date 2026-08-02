package spotify

import "testing"

func TestNormalizeID(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"4aawyAB9vmqN3uQ7FjRGTy", "4aawyAB9vmqN3uQ7FjRGTy"},
		{"spotify:album:4aawyAB9vmqN3uQ7FjRGTy", "4aawyAB9vmqN3uQ7FjRGTy"},
		{"https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy", "4aawyAB9vmqN3uQ7FjRGTy"},
		{"https://open.spotify.com/artist/4aawyAB9vmqN3uQ7FjRGTy?si=abc", "4aawyAB9vmqN3uQ7FjRGTy"},
		{"  4aawyAB9vmqN3uQ7FjRGTy  ", "4aawyAB9vmqN3uQ7FjRGTy"},
		{"short", ""},
		{"", ""},
	}

	for _, tc := range tests {
		if got := NormalizeID(tc.in); got != tc.want {
			t.Fatalf("NormalizeID(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestMapAlbumAndArtist(t *testing.T) {
	year := 2024
	album := mapAlbum(spotifyAlbumPayload{
		ID:          "4aawyAB9vmqN3uQ7FjRGTy",
		Name:        "Test Album",
		AlbumType:   "album",
		TotalTracks: 10,
		ReleaseDate: "2024-01-15",
		Label:       "Label",
		Images:      []spotifyImage{{URL: "https://img/cover.jpg", Width: 640}},
		Artists:     []spotifyArtistRef{{ID: "artistid00000000000001", Name: "Artist"}},
		Genres:      nil,
	})
	if album.Name != "Test Album" || album.ImageURL == "" || album.Year == nil || *album.Year != year {
		t.Fatalf("unexpected album mapping: %+v", album)
	}
	if len(album.Artists) != 1 || album.Artists[0] != "Artist" {
		t.Fatalf("unexpected artists: %+v", album.Artists)
	}
	if album.Genres == nil {
		t.Fatal("genres should be empty slice, not nil")
	}

	artist := mapArtist(spotifyArtistPayload{
		ID:     "artistid00000000000001",
		Name:   "Artist",
		Images: []spotifyImage{{URL: "https://img/artist.jpg", Width: 300}},
	})
	if artist.Name != "Artist" || artist.ImageURL == "" || artist.Genres == nil {
		t.Fatalf("unexpected artist mapping: %+v", artist)
	}
}
