package openlibrary

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
)

func TestRefreshPreservesSubjectRowsOnPartialFailure(t *testing.T) {
	var fantasyHits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/trending/"):
			writeJSON(w, map[string]any{
				"works": []map[string]any{
					{"key": "/works/OL1W", "title": "Fresh Trending", "cover_i": 1},
				},
			})
		case r.URL.Path == "/subjects/fantasy.json":
			fantasyHits.Add(1)
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
		case r.URL.Path == "/subjects/horror.json":
			writeJSON(w, map[string]any{
				"works": []map[string]any{
					{
						"key": "/works/OL9W", "title": "Fresh Horror", "cover_id": 9,
						"authors": []map[string]string{{"key": "/authors/OL1A", "name": "Author"}},
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClient(config.Config{
		OpenLibraryBaseURL:  server.URL,
		OpenLibraryCacheTTL: time.Hour,
	})
	client.subjects = []SubjectRowConfig{
		{Title: "Fantasy", Subject: "fantasy"},
		{Title: "Horror", Subject: "horror"},
	}
	client.http = server.Client()
	client.catalog = &BrowseResponse{
		Trending: []Book{{ID: "OL0W", Title: "Old Trending", CoverURL: fallbackCover}},
		Rows: []SubjectRow{
			{Title: "Fantasy", Subject: "fantasy", Books: []Book{{ID: "OL2W", Title: "Cached Fantasy", CoverURL: fallbackCover}}},
			{Title: "Horror", Subject: "horror", Books: []Book{{ID: "OL3W", Title: "Cached Horror", CoverURL: fallbackCover}}},
		},
		CachedAt: 1000,
	}

	if err := client.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh: %v", err)
	}

	browse, err := client.Browse(context.Background())
	if err != nil {
		t.Fatalf("Browse: %v", err)
	}
	if len(browse.Trending) != 1 || browse.Trending[0].Title != "Fresh Trending" {
		t.Fatalf("trending = %+v", browse.Trending)
	}
	if len(browse.Rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(browse.Rows))
	}
	if browse.Rows[0].Books[0].Title != "Cached Fantasy" {
		t.Fatalf("fantasy row should keep previous books, got %+v", browse.Rows[0].Books)
	}
	if browse.Rows[1].Books[0].Title != "Fresh Horror" {
		t.Fatalf("horror row should refresh, got %+v", browse.Rows[1].Books)
	}
	if fantasyHits.Load() < 1 {
		t.Fatal("expected fantasy subject to be requested")
	}
}

func TestBrowseWaitsForInFlightRefresh(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/trending/") {
			close(started)
			<-release
			writeJSON(w, map[string]any{
				"works": []map[string]any{
					{"key": "/works/OL1W", "title": "Ready", "cover_i": 1},
				},
			})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/subjects/") {
			writeJSON(w, map[string]any{"works": []any{}})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient(config.Config{
		OpenLibraryBaseURL:  server.URL,
		OpenLibraryCacheTTL: time.Hour,
	})
	client.subjects = nil
	client.http = server.Client()

	var refreshErr error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		refreshErr = client.Refresh(context.Background())
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("refresh did not start")
	}

	browseDone := make(chan struct{})
	var browse *BrowseResponse
	var browseErr error
	go func() {
		defer close(browseDone)
		browse, browseErr = client.Browse(context.Background())
	}()

	select {
	case <-browseDone:
		t.Fatal("Browse returned before refresh finished")
	case <-time.After(150 * time.Millisecond):
	}

	close(release)
	wg.Wait()
	select {
	case <-browseDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Browse did not unblock after refresh")
	}

	if refreshErr != nil {
		t.Fatalf("Refresh: %v", refreshErr)
	}
	if browseErr != nil {
		t.Fatalf("Browse: %v", browseErr)
	}
	if browse == nil || len(browse.Trending) != 1 || browse.Trending[0].Title != "Ready" {
		t.Fatalf("browse = %+v", browse)
	}
}

func TestGetJSONRetriesTransientStatuses(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := hits.Add(1)
		if n < 3 {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, map[string]any{
			"works": []map[string]any{
				{"key": "/works/OL1W", "title": "Ok", "cover_i": 1},
			},
		})
	}))
	defer server.Close()

	client := NewClient(config.Config{
		OpenLibraryBaseURL:  server.URL,
		OpenLibraryCacheTTL: time.Hour,
	})
	client.http = server.Client()
	// Avoid rate-limit sleeps dominating the test.
	client.lastRequest = time.Time{}

	books, err := client.fetchTrending(context.Background(), 1)
	if err != nil {
		t.Fatalf("fetchTrending: %v", err)
	}
	if len(books) != 1 || books[0].Title != "Ok" {
		t.Fatalf("books = %+v", books)
	}
	if hits.Load() != 3 {
		t.Fatalf("hits = %d, want 3", hits.Load())
	}
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}
