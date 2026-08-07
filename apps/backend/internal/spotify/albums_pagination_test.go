package spotify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestFetchArtistAlbumsCapsPagesAndStopsOnDuplicateStall(t *testing.T) {
	t.Parallel()
	const artistID = "artist0000000000000001"
	var albumHits atomic.Int32

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok", "token_type": "Bearer", "expires_in": 3600,
			})
		case strings.HasSuffix(r.URL.Path, "/albums"):
			n := albumHits.Add(1)
			// Always return the same 10 albums with Next set — previously this
			// could loop until timeout trying to reach maxItems unique albums.
			unique := []string{
				"albumdup00000000000001",
				"albumdup00000000000002",
				"albumdup00000000000003",
			}
			items := make([]map[string]any, 0, defaultLimit)
			for i := 0; i < defaultLimit; i++ {
				id := unique[i%len(unique)]
				items = append(items, map[string]any{
					"id": id, "name": "Dup Album",
					"images":  []map[string]any{},
					"artists": []map[string]any{{"id": artistID, "name": "Artist"}},
				})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": items,
				"next":  "https://api.spotify.com/v1/artists/" + artistID + "/albums?offset=" + strconv.Itoa(int(n)*10),
				"total": 5000,
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

	albums, err := client.fetchArtistAlbums(context.Background(), artistID, 50, "album,single,compilation")
	if err != nil {
		t.Fatalf("fetchArtistAlbums: %v", err)
	}
	if albumHits.Load() > int32(discographyMaxPages) {
		t.Fatalf("expected at most %d album pages, got %d", discographyMaxPages, albumHits.Load())
	}
	// Stall break should stop after first duplicate-only follow-up page at worst.
	if albumHits.Load() > 2 {
		t.Fatalf("duplicate stall should stop early, got %d hits", albumHits.Load())
	}
	if len(albums) == 0 {
		t.Fatal("expected some unique albums")
	}
	if len(albums) > 3 {
		t.Fatalf("expected ≤3 unique albums from fixture, got %d", len(albums))
	}
}

func TestListArtistAlbumsUsesSinglePage(t *testing.T) {
	t.Parallel()
	const artistID = "artist0000000000000001"
	var albumHits atomic.Int32
	var searchHits atomic.Int32
	var artistHits atomic.Int32
	var topHits atomic.Int32

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok", "token_type": "Bearer", "expires_in": 3600,
			})
		case r.URL.Path == "/artists/"+artistID:
			artistHits.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": artistID, "name": "Demo Artist", "images": []map[string]any{},
			})
		case strings.HasSuffix(r.URL.Path, "/top-tracks"):
			topHits.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"tracks": []any{}})
		case strings.HasSuffix(r.URL.Path, "/albums"):
			albumHits.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{
					"id": "album00000000000000001", "name": "Only Album",
					"images":  []map[string]any{{"url": "https://img"}},
					"artists": []map[string]any{{"id": artistID, "name": "Demo Artist"}},
				}},
				"next":  "",
				"total": 1,
			})
		case r.URL.Path == "/search":
			searchHits.Add(1)
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

	albums, err := client.ListArtistAlbums(context.Background(), artistID, 10, ArtistHints{Name: "Demo Artist"})
	if err != nil {
		t.Fatalf("ListArtistAlbums: %v", err)
	}
	if len(albums) != 1 {
		t.Fatalf("albums=%+v", albums)
	}
	if albumHits.Load() != 1 {
		t.Fatalf("expected 1 albums call, got %d", albumHits.Load())
	}
	if artistHits.Load() != 0 || topHits.Load() != 0 || searchHits.Load() != 0 {
		t.Fatalf("lite path must not hit artist/top-tracks/search (artist=%d top=%d search=%d)",
			artistHits.Load(), topHits.Load(), searchHits.Load())
	}
}
