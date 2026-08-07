package musicbrainz

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestGetJSONRetriesBusy(t *testing.T) {
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := hits.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"The MusicBrainz web server is currently busy. Please try again later."}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"artists": []map[string]any{
				{"id": "a74b1b7f-71a5-4011-9441-d0b5e4122711", "name": "Radiohead", "score": 100},
			},
		})
	}))
	defer upstream.Close()

	c := NewClient(config.Config{
		MusicBrainzAPIBaseURL:  upstream.URL,
		CoverArtArchiveBaseURL: "https://coverartarchive.org",
		MusicCatalogCacheTTL:   time.Hour,
	})
	c.http = upstream.Client()
	c.now = time.Now
	// Don't wait a full second between retries in this unit test.
	// waitRate still applies; shorten by setting lastReq in the past via wait.

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := c.Search(ctx, "Radiohead")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(res.Artists) == 0 || res.Artists[0].Name != "Radiohead" {
		t.Fatalf("artists = %#v", res.Artists)
	}
	if hits.Load() < 3 {
		t.Fatalf("expected retries, hits=%d", hits.Load())
	}
}
