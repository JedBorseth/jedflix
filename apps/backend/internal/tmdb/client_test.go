package tmdb

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestSanitizePath(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"movie/550", "movie/550", false},
		{"/trending/movie/week", "trending/movie/week", false},
		{"", "", true},
		{"../etc/passwd", "", true},
		{"movie/550?x=1", "", true},
		{"http://evil.com", "", true},
	}
	for _, tc := range cases {
		got, err := SanitizePath(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Fatalf("SanitizePath(%q) expected error", tc.in)
			}
			continue
		}
		if err != nil {
			t.Fatalf("SanitizePath(%q): %v", tc.in, err)
		}
		if got != tc.want {
			t.Fatalf("SanitizePath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestProxyGETInjectsAPIKeyAndForwardsQuery(t *testing.T) {
	t.Parallel()
	var gotPath string
	var gotQuery url.Values
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	client := NewClient(config.Config{
		TMDBAPIKey:     "server-secret",
		TMDBAPIBaseURL: upstream.URL,
	})
	query := url.Values{}
	query.Set("page", "2")
	query.Set("api_key", "client-should-not-win")

	result, err := client.ProxyGET(context.Background(), "search/multi", query)
	if err != nil {
		t.Fatalf("ProxyGET: %v", err)
	}
	if result.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", result.StatusCode)
	}
	if gotPath != "/search/multi" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotQuery.Get("api_key") != "server-secret" {
		t.Fatalf("api_key = %q", gotQuery.Get("api_key"))
	}
	if gotQuery.Get("page") != "2" {
		t.Fatalf("page = %q", gotQuery.Get("page"))
	}
}

func TestProxyGETRejectsUnconfigured(t *testing.T) {
	t.Parallel()
	client := NewClient(config.Config{})
	_, err := client.ProxyGET(context.Background(), "movie/1", nil)
	if err == nil {
		t.Fatal("expected error when TMDB key missing")
	}
}
