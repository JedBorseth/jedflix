package spotify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestGetAlbumFallsBackToSearchWhenAlbumEndpointForbidden(t *testing.T) {
	t.Parallel()
	const albumID = "album00000000000000001" // 22 chars
	const trackID = "track00000000000000001"
	const artistID = "artist0000000000000001"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok", "token_type": "Bearer", "expires_in": 3600,
			})
		case strings.HasPrefix(r.URL.Path, "/albums/"):
			http.Error(w, `{"error":{"status":403,"message":"Forbidden"}}`, http.StatusForbidden)
		case r.URL.Path == "/search":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tracks": map[string]any{
					"items": []map[string]any{{
						"id": trackID, "name": "Song A", "duration_ms": 1000,
						"track_number": 1, "disc_number": 1,
						"artists": []map[string]any{{"id": artistID, "name": "Artist"}},
						"album": map[string]any{
							"id": albumID, "name": "Demo Album",
							"images": []map[string]any{{"url": "https://img"}},
						},
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

	album, err := client.GetAlbumWithHints(context.Background(), albumID, AlbumHints{
		Name:    "Demo Album",
		Artists: []string{"Artist"},
	})
	if err != nil {
		t.Fatalf("GetAlbumWithHints: %v", err)
	}
	if album.Name != "Demo Album" || len(album.Tracks) != 1 {
		t.Fatalf("unexpected album: %+v", album)
	}
}

func TestGetArtistFallsBackWhenArtistEndpointForbidden(t *testing.T) {
	t.Parallel()
	const artistID = "artist0000000000000001"
	const albumID = "album00000000000000001"
	const trackID = "track00000000000000001"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok", "token_type": "Bearer", "expires_in": 3600,
			})
		case r.URL.Path == "/artists/"+artistID:
			http.Error(w, `{"error":{"status":403,"message":"Forbidden"}}`, http.StatusForbidden)
		case strings.HasSuffix(r.URL.Path, "/top-tracks"):
			http.Error(w, `{"error":{"status":403,"message":"Forbidden"}}`, http.StatusForbidden)
		case strings.HasSuffix(r.URL.Path, "/albums"):
			http.Error(w, `{"error":{"status":403,"message":"Forbidden"}}`, http.StatusForbidden)
		case r.URL.Path == "/search":
			q := r.URL.Query().Get("q")
			typeParam := r.URL.Query().Get("type")
			if typeParam == "track" || strings.Contains(typeParam, "track") {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"tracks": map[string]any{
						"items": []map[string]any{{
							"id": trackID, "name": "Hit", "duration_ms": 2000,
							"artists": []map[string]any{{"id": artistID, "name": "Demo Artist"}},
							"album": map[string]any{
								"id": albumID, "name": "Hits",
								"images": []map[string]any{{"url": "https://img"}},
							},
						}},
					},
				})
				return
			}
			if typeParam == "album" || strings.Contains(q, "artist:") {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"albums": map[string]any{
						"items": []map[string]any{{
							"id": albumID, "name": "Hits", "total_tracks": 1,
							"artists": []map[string]any{{"id": artistID, "name": "Demo Artist"}},
							"images":  []map[string]any{{"url": "https://img"}},
						}},
					},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{})
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

	artist, err := client.GetArtistWithHints(context.Background(), artistID, ArtistHints{
		Name: "Demo Artist",
	})
	if err != nil {
		t.Fatalf("GetArtistWithHints: %v", err)
	}
	if artist.Name != "Demo Artist" {
		t.Fatalf("name = %q", artist.Name)
	}
	if len(artist.TopTracks) == 0 {
		t.Fatal("expected top tracks from search fallback")
	}
}
