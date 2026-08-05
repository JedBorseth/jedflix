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

func TestRefreshBuildsCuratedGenreRows(t *testing.T) {
	var browseHits int
	var relatedHits int
	var searchHits int
	var artistAlbumHits int

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
			if typ == "artist" {
				id := "seedartist000000000001"
				name := q
				if q == "Taylor Swift" {
					id = "taylorswift00000000001"
					name = "Taylor Swift"
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"artists": map[string]any{
						"items": []map[string]any{{
							"id":         id,
							"name":       name,
							"popularity": 90,
							"images":     []map[string]any{{"url": "https://img/ar.jpg", "width": 300}},
							"followers":  map[string]any{"total": 1000},
							"genres":     []string{"pop"},
						}},
					},
				})
				return
			}
			// New releases album search
			_ = json.NewEncoder(w).Encode(map[string]any{
				"albums": map[string]any{
					"items": []map[string]any{{
						"id":           "newrelease0000000000001",
						"name":         "Album " + q,
						"album_type":   "album",
						"release_date": "2026-01-01",
						"images":       []map[string]any{{"url": "https://img/a.jpg", "width": 300}},
						"artists":      []map[string]any{{"id": "artistid00000000000001", "name": "Artist"}},
					}},
				},
			})
		case strings.HasSuffix(r.URL.Path, "/related-artists"):
			relatedHits++
			_ = json.NewEncoder(w).Encode(map[string]any{
				"artists": []map[string]any{
					{
						"id": "relatedartist0000000001", "name": "Related One", "popularity": 85,
						"images":    []map[string]any{{"url": "https://img/r1.jpg", "width": 300}},
						"followers": map[string]any{"total": 800},
					},
					{
						"id": "relatedartist0000000002", "name": "Related Two", "popularity": 70,
						"images":    []map[string]any{{"url": "https://img/r2.jpg", "width": 300}},
						"followers": map[string]any{"total": 400},
					},
					// Duplicate of seed should be deduped.
					{
						"id": "taylorswift00000000001", "name": "Taylor Swift", "popularity": 95,
						"images":    []map[string]any{{"url": "https://img/ts.jpg", "width": 300}},
						"followers": map[string]any{"total": 2000},
					},
				},
			})
		case strings.Contains(r.URL.Path, "/albums") && strings.HasPrefix(r.URL.Path, "/artists/"):
			artistAlbumHits++
			group := r.URL.Query().Get("include_groups")
			albumType := "album"
			albumID := "albumid000000000000001"
			if group == "single" {
				albumType = "single"
				albumID = "singleid00000000000001"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{
					"id": albumID, "name": "Release " + group, "album_type": albumType,
					"release_date": "2025-06-01",
					"images":       []map[string]any{{"url": "https://img/rel.jpg", "width": 300}},
					"artists":      []map[string]any{{"id": "taylorswift00000000001", "name": "Taylor Swift"}},
				}},
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
	client.genres = []GenreConfig{
		{Key: "pop", Title: "Pop", Seeds: []string{"Taylor Swift"}},
	}

	if err := client.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}
	if browseHits != 0 {
		t.Fatalf("expected no /browse calls, got %d", browseHits)
	}
	if relatedHits == 0 {
		t.Fatal("expected related-artists calls")
	}
	if searchHits == 0 {
		t.Fatal("expected /search calls for seed resolve + new releases")
	}
	if artistAlbumHits == 0 {
		t.Fatal("expected artist album/single fetches")
	}

	browse, err := client.Browse(context.Background())
	if err != nil {
		t.Fatalf("Browse failed: %v", err)
	}
	if len(browse.NewReleases) == 0 {
		t.Fatal("expected new releases from search")
	}

	keys := make([]string, 0, len(browse.Rows))
	for _, row := range browse.Rows {
		keys = append(keys, row.Key)
	}
	wantKeys := []string{"pop-artists", "pop-albums", "pop-singles", "new-releases"}
	if len(keys) != len(wantKeys) {
		t.Fatalf("expected keys %v, got %v", wantKeys, keys)
	}
	for i, want := range wantKeys {
		if keys[i] != want {
			t.Fatalf("row %d key = %q, want %q (all=%v)", i, keys[i], want, keys)
		}
	}

	artistsRow := browse.Rows[0]
	if len(artistsRow.Artists) != 3 {
		t.Fatalf("expected 3 deduped artists (seed + 2 related), got %d: %+v", len(artistsRow.Artists), artistsRow.Artists)
	}
	if artistsRow.Artists[0].ID != "taylorswift00000000001" {
		t.Fatalf("expected highest-popularity artist first, got %+v", artistsRow.Artists[0])
	}
	if browse.Rows[1].Title != "Popular Pop Albums" || browse.Rows[2].Title != "Popular Pop Singles" {
		t.Fatalf("unexpected titles: %q / %q", browse.Rows[1].Title, browse.Rows[2].Title)
	}
}

func TestExpandGenreArtistsFallsBackToSeedsWhenRelatedForbidden(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "test-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		case r.URL.Path == "/search":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"artists": map[string]any{
					"items": []map[string]any{{
						"id": "drakeartist000000000001", "name": "Drake", "popularity": 95,
						"images":    []map[string]any{{"url": "https://img/d.jpg", "width": 300}},
						"followers": map[string]any{"total": 5000},
					}},
				},
			})
		case strings.HasSuffix(r.URL.Path, "/related-artists"):
			http.Error(w, `{"error":{"status":403,"message":"Forbidden"}}`, http.StatusForbidden)
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

	artists, err := client.expandGenreArtists(context.Background(), GenreConfig{
		Key:   "hipHop",
		Title: "Hip-Hop",
		Seeds: []string{"Drake"},
	})
	if err != nil {
		t.Fatalf("expandGenreArtists: %v", err)
	}
	if len(artists) != 1 || artists[0].Name != "Drake" {
		t.Fatalf("expected seed-only fallback, got %+v", artists)
	}
}

func TestResolveArtistByNamePrefersExactMatch(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "test-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		case r.URL.Path == "/search":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"artists": map[string]any{
					"items": []map[string]any{
						{
							"id": "musetribute000000000001", "name": "Muse Tribute Band", "popularity": 99,
							"images": []map[string]any{{"url": "https://img/t.jpg", "width": 300}},
						},
						{
							"id": "musereal000000000000001", "name": "Muse", "popularity": 80,
							"images": []map[string]any{{"url": "https://img/m.jpg", "width": 300}},
						},
					},
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

	artist, err := client.resolveArtistByName(context.Background(), "Muse")
	if err != nil {
		t.Fatalf("resolveArtistByName: %v", err)
	}
	if artist.ID != "musereal000000000000001" || artist.Name != "Muse" {
		t.Fatalf("expected exact name match over higher-popularity partial, got %+v", artist)
	}
}

func TestSearchSortsByRelevance(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "test-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
			})
		case r.URL.Path == "/search":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"artists": map[string]any{
					"items": []map[string]any{
						{
							"id": "artistribute00000000001", "name": "Thriller Tribute Band", "popularity": 95,
							"images": []map[string]any{{"url": "https://img/t.jpg", "width": 300}},
						},
						{
							"id": "artistmj000000000000001", "name": "Michael Jackson", "popularity": 90,
							"images": []map[string]any{{"url": "https://img/m.jpg", "width": 300}},
						},
					},
				},
				"albums": map[string]any{
					"items": []map[string]any{
						{
							"id": "albumkaraoke00000000001", "name": "Thriller Karaoke", "popularity": 99,
							"images":  []map[string]any{{"url": "https://img/a.jpg", "width": 300}},
							"artists": []map[string]any{{"id": "artistribute00000000001", "name": "Thriller Tribute Band"}},
						},
						{
							"id": "albumthriller0000000001", "name": "Thriller", "popularity": 88,
							"images":  []map[string]any{{"url": "https://img/b.jpg", "width": 300}},
							"artists": []map[string]any{{"id": "artistmj000000000000001", "name": "Michael Jackson"}},
						},
					},
				},
				"tracks": map[string]any{
					"items": []map[string]any{},
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

	result, err := client.Search(context.Background(), "thriller")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(result.Albums) < 2 || result.Albums[0].Name != "Thriller" {
		t.Fatalf("expected exact-match album first, got %+v", result.Albums)
	}
	if len(result.Artists) < 1 || result.Artists[0].Name != "Thriller Tribute Band" {
		t.Fatalf("expected prefix artist match first, got %+v", result.Artists)
	}
}

func TestScoreNameMatchExactBeatsPopularPartial(t *testing.T) {
	exact := scoreNameMatch("thriller", "Thriller", 55)
	partial := scoreNameMatch("thriller", "Thriller Night Live", 99)
	if exact <= partial {
		t.Fatalf("exact=%d should beat partial=%d", exact, partial)
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
						"images":  []map[string]any{{"url": "https://img/a.jpg", "width": 300}},
						"artists": []map[string]any{{"id": "artistid00000000000001", "name": "A"}},
					}}},
					{"track": map[string]any{"album": map[string]any{
						"id": "albumid000000000000001", "name": "Album A", "album_type": "album",
						"images":  []map[string]any{{"url": "https://img/a.jpg", "width": 300}},
						"artists": []map[string]any{{"id": "artistid00000000000001", "name": "A"}},
					}}},
					{"track": map[string]any{"album": map[string]any{
						"id": "albumid000000000000002", "name": "Album B", "album_type": "album",
						"images":  []map[string]any{{"url": "https://img/b.jpg", "width": 300}},
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
	albums, err := client.fetchPlaylistAlbums(context.Background(), "37i9dQZF1DX0XUsuxWHRQd", 10)
	if err != nil {
		t.Fatalf("fetchPlaylistAlbums: %v", err)
	}
	if len(albums) != 2 {
		t.Fatalf("expected 2 unique albums, got %d", len(albums))
	}
}

func TestFetchPlaylistArtists(t *testing.T) {
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
					{"track": map[string]any{"artists": []map[string]any{
						{"id": "artistid00000000000001", "name": "A"},
					}}},
					{"track": map[string]any{"artists": []map[string]any{
						{"id": "artistid00000000000001", "name": "A"},
					}}},
					{"track": map[string]any{"artists": []map[string]any{
						{"id": "artistid00000000000002", "name": "B"},
						{"id": "artistid00000000000003", "name": "C"},
					}}},
				},
				"next": "",
			})
		case r.URL.Path == "/artists/artistid00000000000001":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "artistid00000000000001", "name": "Artist A", "popularity": 80,
				"images":    []map[string]any{{"url": "https://img/a.jpg", "width": 300}},
				"followers": map[string]any{"total": 1000},
			})
		case r.URL.Path == "/artists/artistid00000000000002":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "artistid00000000000002", "name": "Artist B", "popularity": 70,
				"images":    []map[string]any{{"url": "https://img/b.jpg", "width": 300}},
				"followers": map[string]any{"total": 500},
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
	artists, err := client.fetchPlaylistArtists(context.Background(), "37i9dQZF1DWXRqgorJj26U", 10)
	if err != nil {
		t.Fatalf("fetchPlaylistArtists: %v", err)
	}
	if len(artists) != 2 {
		t.Fatalf("expected 2 unique primary artists, got %d", len(artists))
	}
	if artists[0].Name != "Artist A" || artists[1].Name != "Artist B" {
		t.Fatalf("unexpected artist order/names: %+v", artists)
	}
}
