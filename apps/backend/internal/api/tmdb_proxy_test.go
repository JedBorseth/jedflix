package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/tmdb"
)

func TestTmdbProxyForwardsAndHidesKey(t *testing.T) {
	var gotAPIKey string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAPIKey = r.URL.Query().Get("api_key")
		if r.URL.Path != "/trending/movie/week" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"results": []any{}})
	}))
	defer upstream.Close()

	cfg := config.Config{
		CORSOrigins:    []string{"http://localhost:5173"},
		TMDBAPIKey:     "server-only-key",
		TMDBAPIBaseURL: upstream.URL,
	}
	client := tmdb.NewClient(cfg)
	server := NewServer(cfg, nil, nil, nil, nil, nil, client)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tmdb/trending/movie/week?page=1&api_key=leaked", nil)
	rec := httptest.NewRecorder()
	server.Router().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if gotAPIKey != "server-only-key" {
		t.Fatalf("upstream api_key = %q", gotAPIKey)
	}
	if body := rec.Body.String(); body == "" || !json.Valid(rec.Body.Bytes()) {
		t.Fatalf("expected JSON body, got %q", body)
	}
}

func TestTmdbProxyRequiresConfig(t *testing.T) {
	cfg := config.Config{CORSOrigins: []string{"*"}}
	server := NewServer(cfg, nil, nil, nil, nil, nil, tmdb.NewClient(cfg))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tmdb/movie/1", nil)
	rec := httptest.NewRecorder()
	server.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
}
