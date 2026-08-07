package spotify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestCatalogPersistsAcrossClients(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "spotify-catalog.json")
	var searchHits atomic.Int32

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok", "token_type": "Bearer", "expires_in": 3600,
			})
		case "/search":
			searchHits.Add(1)
			typ := r.URL.Query().Get("type")
			if typ == "artist" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"artists": map[string]any{
						"items": []map[string]any{{
							"id": "artist0000000000000001", "name": "Cached Artist",
							"images": []map[string]any{{"url": "https://img"}},
						}},
					},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"albums": map[string]any{
					"items": []map[string]any{{
						"id": "album00000000000000001", "name": "Cached Album",
						"images":  []map[string]any{{"url": "https://img"}},
						"artists": []map[string]any{{"id": "artist0000000000000001", "name": "Cached Artist"}},
					}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	first := NewClient(config.Config{
		SpotifyClientID:     "id",
		SpotifyClientSecret: "secret",
		SpotifyAPIBaseURL:   upstream.URL,
		SpotifyAuthURL:      upstream.URL + "/api/token",
		SpotifyCacheTTL:     time.Hour,
		SpotifyCatalogPath:  path,
	})
	first.genres = []GenreConfig{{Key: "pop", Title: "Pop", SearchQuery: "pop"}}
	if err := first.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected catalog file: %v", err)
	}
	hitsAfterRefresh := searchHits.Load()
	if hitsAfterRefresh == 0 {
		t.Fatal("expected Spotify searches during refresh")
	}

	// Simulate restart: new client, Spotify down / rate limited.
	blocked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/token" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok", "token_type": "Bearer", "expires_in": 3600,
			})
			return
		}
		w.Header().Set("Retry-After", "60")
		http.Error(w, `{"error":{"status":429}}`, http.StatusTooManyRequests)
	}))
	defer blocked.Close()

	second := NewClient(config.Config{
		SpotifyClientID:     "id",
		SpotifyClientSecret: "secret",
		SpotifyAPIBaseURL:   blocked.URL,
		SpotifyAuthURL:      blocked.URL + "/api/token",
		SpotifyCacheTTL:     time.Hour,
		SpotifyCatalogPath:  path,
	})
	if !second.loadPersistedCatalog() {
		t.Fatal("expected persisted catalog load")
	}
	browse, err := second.Browse(context.Background())
	if err != nil {
		t.Fatalf("Browse after restart: %v", err)
	}
	if len(browse.Rows) == 0 {
		t.Fatal("expected rows from disk")
	}
	found := false
	for _, row := range browse.Rows {
		if row.Key == "pop-artists" && len(row.Artists) > 0 && row.Artists[0].Name == "Cached Artist" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing persisted artist row: %+v", browse.Rows)
	}

	// Fresh Refresh while rate-limited must not wipe the served catalog.
	if err := second.Refresh(context.Background()); err == nil {
		t.Fatal("expected refresh failure under 429")
	} else if !errors.Is(err, ErrRateLimited) && !strings.Contains(err.Error(), "rate limited") {
		// May wrap differently depending on first failing call.
		t.Logf("refresh err: %v", err)
	}
	browse2, err := second.Browse(context.Background())
	if err != nil {
		t.Fatalf("Browse after failed refresh: %v", err)
	}
	if len(browse2.Rows) == 0 {
		t.Fatal("catalog should survive failed refresh")
	}
}

func TestStartSkipsImmediateRefreshWhenPersistedFresh(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "catalog.json")
	var searchHits atomic.Int32

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok", "token_type": "Bearer", "expires_in": 3600,
			})
		case "/search":
			searchHits.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"artists": map[string]any{"items": []map[string]any{}},
				"albums":  map[string]any{"items": []map[string]any{}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	payload := persistedCatalog{
		Version: catalogFileVersion,
		SavedAt: time.Now().UnixMilli(),
		Browse: BrowseResponse{
			CachedAt: time.Now().UnixMilli(),
			Rows: []CatalogRow{{
				Title: "Popular Pop Artists",
				Key:   "pop-artists",
				Kind:  "artists",
				Artists: []Artist{{
					ID: "artist0000000000000001", Name: "Disk Artist", ImageURL: "https://img", Genres: []string{},
				}},
			}},
		},
	}
	data, _ := json.Marshal(payload)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	client := NewClient(config.Config{
		SpotifyClientID:     "id",
		SpotifyClientSecret: "secret",
		SpotifyAPIBaseURL:   upstream.URL,
		SpotifyAuthURL:      upstream.URL + "/api/token",
		SpotifyCacheTTL:     time.Hour,
		SpotifyCatalogPath:  path,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client.Start(ctx)
	time.Sleep(50 * time.Millisecond)
	if searchHits.Load() != 0 {
		t.Fatalf("fresh persisted catalog should skip startup refresh, hits=%d", searchHits.Load())
	}
	browse, err := client.Browse(ctx)
	if err != nil {
		t.Fatalf("Browse: %v", err)
	}
	if len(browse.Rows) != 1 || browse.Rows[0].Artists[0].Name != "Disk Artist" {
		t.Fatalf("unexpected browse: %+v", browse)
	}
}
