package spotify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
)

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

func TestRefreshUsesSearchNotBrowseNewReleases(t *testing.T) {
	var browseHits int
	var searchHits int

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "test-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		case strings.HasPrefix(r.URL.Path, "/browse/"):
			browseHits++
			http.Error(w, `{"error":{"status":403,"message":"Forbidden"}}`, http.StatusForbidden)
		case r.URL.Path == "/search":
			searchHits++
			q := r.URL.Query().Get("q")
			typ := r.URL.Query().Get("type")
			limit := r.URL.Query().Get("limit")
			if limit != "10" {
				t.Errorf("expected search limit=10, got %q", limit)
			}
			if typ == "album" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"albums": map[string]any{
						"items": []map[string]any{{
							"id":           "4aawyAB9vmqN3uQ7FjRGTy",
							"name":         "Album " + q,
							"album_type":   "album",
							"release_date": "2026-01-01",
							"images":       []map[string]any{{"url": "https://img/a.jpg", "width": 300}},
							"artists":      []map[string]any{{"id": "artistid00000000000001", "name": "Artist"}},
						}},
					},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"artists": map[string]any{
					"items": []map[string]any{{
						"id":     "artistid00000000000001",
						"name":   "Artist " + q,
						"images": []map[string]any{{"url": "https://img/ar.jpg", "width": 300}},
						"genres": []string{"pop"},
					}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := NewClient(config.Config{
		SpotifyClientID:     "id",
		SpotifyClientSecret: "secret",
		SpotifyAPIBaseURL:   upstream.URL,
		SpotifyAuthURL:      upstream.URL + "/api/token",
		SpotifyCacheTTL:     time.Hour,
	})
	// Keep refresh light for the unit test.
	client.rows = []RowConfig{
		{Title: "New Releases", Key: "new-releases", Kind: "albums", Query: "tag:new"},
		{Title: "Popular Artists", Key: "popular-artists", Kind: "artists", Query: "pop"},
	}

	if err := client.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}
	if browseHits != 0 {
		t.Fatalf("expected no /browse calls, got %d", browseHits)
	}
	if searchHits == 0 {
		t.Fatal("expected /search calls")
	}

	browse, err := client.Browse(context.Background())
	if err != nil {
		t.Fatalf("Browse failed: %v", err)
	}
	if len(browse.NewReleases) == 0 {
		t.Fatal("expected new releases from search")
	}
	if len(browse.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(browse.Rows))
	}
}

func TestFetchPlaylistAlbums(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "test-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		case strings.HasPrefix(r.URL.Path, "/playlists/") && strings.HasSuffix(r.URL.Path, "/tracks"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{
					{"track": map[string]any{"album": map[string]any{
						"id": "albumid000000000000001", "name": "Album A", "album_type": "album",
						"images": []map[string]any{{"url": "https://img/a.jpg", "width": 300}},
						"artists": []map[string]any{{"id": "artistid00000000000001", "name": "A"}},
					}}},
					{"track": map[string]any{"album": map[string]any{
						"id": "albumid000000000000001", "name": "Album A", "album_type": "album",
						"images": []map[string]any{{"url": "https://img/a.jpg", "width": 300}},
						"artists": []map[string]any{{"id": "artistid00000000000001", "name": "A"}},
					}}},
					{"track": map[string]any{"album": map[string]any{
						"id": "albumid000000000000002", "name": "Album B", "album_type": "album",
						"images": []map[string]any{{"url": "https://img/b.jpg", "width": 300}},
						"artists": []map[string]any{{"id": "artistid00000000000002", "name": "B"}},
					}}},
				},
				"next": "",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := NewClient(config.Config{
		SpotifyClientID:     "id",
		SpotifyClientSecret: "secret",
		SpotifyAPIBaseURL:   upstream.URL,
		SpotifyAuthURL:      upstream.URL + "/api/token",
		SpotifyCacheTTL:     time.Hour,
	})
	albums, err := client.fetchPlaylistAlbums(context.Background(), "37i9dQZF1EQnqst5TRi17F", 10)
	if err != nil {
		t.Fatalf("fetchPlaylistAlbums: %v", err)
	}
	if len(albums) != 2 {
		t.Fatalf("expected 2 unique albums, got %d", len(albums))
	}
}

