package spotify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestSearchCachesAndRateLimitTripsCircuit(t *testing.T) {
	t.Parallel()
	var searchHits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok", "token_type": "Bearer", "expires_in": 3600,
			})
		case "/search":
			n := searchHits.Add(1)
			if n == 1 {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"artists": map[string]any{
						"items": []map[string]any{{
							"id": "artist0000000000000001", "name": "Cher",
							"images": []map[string]any{},
						}},
					},
				})
				return
			}
			w.Header().Set("Retry-After", "2")
			http.Error(w, `{"error":{"status":429,"message":"Too Many Requests"}}`, http.StatusTooManyRequests)
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

	first, err := client.Search(context.Background(), "Cher")
	if err != nil {
		t.Fatalf("first search: %v", err)
	}
	if len(first.Artists) != 1 {
		t.Fatalf("artists = %#v", first.Artists)
	}

	// Cached — should not hit upstream again.
	second, err := client.Search(context.Background(), "Cher")
	if err != nil {
		t.Fatalf("cached search: %v", err)
	}
	if len(second.Artists) != 1 {
		t.Fatalf("cached artists = %#v", second.Artists)
	}
	if searchHits.Load() != 1 {
		t.Fatalf("expected 1 upstream search, got %d", searchHits.Load())
	}

	// Different query trips 429 and opens the circuit.
	_, err = client.Search(context.Background(), "Other Artist")
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("expected rate limit, got %v", err)
	}
	if searchHits.Load() != 2 {
		t.Fatalf("expected 2 upstream searches, got %d", searchHits.Load())
	}

	// Circuit open — fail fast with no extra upstream call.
	_, err = client.Search(context.Background(), "Third Artist")
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("expected circuit open, got %v", err)
	}
	if searchHits.Load() != 2 {
		t.Fatalf("circuit should not call upstream, got %d hits", searchHits.Load())
	}
}
