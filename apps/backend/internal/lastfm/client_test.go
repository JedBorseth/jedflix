package lastfm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/spotify"
)

func TestClientSimilarArtistsAndTracks(t *testing.T) {
	var seenMethods []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method := r.URL.Query().Get("method")
		seenMethods = append(seenMethods, method)
		w.Header().Set("Content-Type", "application/json")
		switch strings.ToLower(method) {
		case "artist.getsimilar":
			_, _ = w.Write([]byte(`{
				"similarartists": {
					"artist": [
						{"name":"Artist A","match":1,"mbid":"","url":"https://last.fm/a","image":[{"#text":"https://img/a","size":"large"}]},
						{"name":"Artist B","match":"0.8","mbid":"","url":"https://last.fm/b","image":[]}
					]
				}
			}`))
		case "track.getsimilar":
			_, _ = w.Write([]byte(`{
				"similartracks": {
					"track": [
						{"name":"Song 1","match":1,"artist":{"name":"Artist A"},"image":[{"#text":"https://img/1","size":"large"}]},
						{"name":"Song 2","match":"0.5","artist":{"name":"Artist B"},"image":[]}
					]
				}
			}`))
		case "artist.gettoptags":
			_, _ = w.Write([]byte(`{
				"toptags": {
					"tag": [
						{"name":"indie","count":100},
						{"name":"rock","count":80}
					]
				}
			}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	client := NewClient(config.Config{
		LastFMAPIKey:     "test-key",
		LastFMAPIBaseURL: upstream.URL,
		LastFMCacheTTL:   time.Hour,
	})
	client.http = upstream.Client()

	artists, err := client.GetSimilarArtists(context.Background(), "Cher", 10)
	if err != nil {
		t.Fatalf("GetSimilarArtists: %v", err)
	}
	if len(artists) != 2 || artists[0].Name != "Artist A" {
		t.Fatalf("artists = %#v", artists)
	}

	// Cache hit should not re-hit upstream.
	_, err = client.GetSimilarArtists(context.Background(), "Cher", 10)
	if err != nil {
		t.Fatalf("cached GetSimilarArtists: %v", err)
	}
	if countMethod(seenMethods, "artist.getSimilar") != 1 {
		t.Fatalf("expected 1 similar-artists call, got %v", seenMethods)
	}

	tracks, err := client.GetSimilarTracks(context.Background(), "Cher", "Believe", 10)
	if err != nil {
		t.Fatalf("GetSimilarTracks: %v", err)
	}
	if len(tracks) != 2 || tracks[0].Artist != "Artist A" {
		t.Fatalf("tracks = %#v", tracks)
	}

	tags, err := client.GetArtistTopTags(context.Background(), "Cher")
	if err != nil {
		t.Fatalf("GetArtistTopTags: %v", err)
	}
	if len(tags) != 2 || tags[0].Name != "indie" {
		t.Fatalf("tags = %#v", tags)
	}
}

func TestServiceResolvesToSpotify(t *testing.T) {
	lfmUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method := strings.ToLower(r.URL.Query().Get("method"))
		w.Header().Set("Content-Type", "application/json")
		if method == "artist.getsimilar" {
			_, _ = w.Write([]byte(`{
				"similarartists": {
					"artist": [
						{"name":"Exact Match","match":"1"},
						{"name":"Unresolvable XYZ","match":"0.9"}
					]
				}
			}`))
			return
		}
		if method == "track.getsimilar" {
			_, _ = w.Write([]byte(`{
				"similartracks": {
					"track": [
						{"name":"Hit Song","match":"1","artist":{"name":"Exact Match"}}
					]
				}
			}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer lfmUpstream.Close()

	searcher := &fakeSpotify{
		artists: map[string]spotify.Artist{
			"exact match": {ID: "artist1111111111111111", Name: "Exact Match", ImageURL: "https://img", Genres: []string{"rock"}},
		},
		tracks: map[string]spotify.TopTrack{
			"exact match|hit song": {
				ID: "track11111111111111111", Name: "Hit Song", Artists: []string{"Exact Match"},
				ArtistIDs: []string{"artist1111111111111111"}, AlbumID: "album1111111111111111",
				AlbumName: "Album", ImageURL: "https://img", DurationMs: 200000,
			},
		},
	}

	lfm := NewClient(config.Config{
		LastFMAPIKey:     "test-key",
		LastFMAPIBaseURL: lfmUpstream.URL,
		LastFMCacheTTL:   time.Hour,
	})
	lfm.http = lfmUpstream.Client()
	svc := NewService(lfm, searcher)

	artists, err := svc.SimilarArtists(context.Background(), "Seed", 10)
	if err != nil {
		t.Fatalf("SimilarArtists: %v", err)
	}
	if len(artists) != 1 || artists[0].ID != "artist1111111111111111" {
		t.Fatalf("resolved artists = %#v", artists)
	}

	tracks, err := svc.SimilarTracks(context.Background(), "Exact Match", "Other", 10)
	if err != nil {
		t.Fatalf("SimilarTracks: %v", err)
	}
	if len(tracks) != 1 || tracks[0].ID != "track11111111111111111" {
		t.Fatalf("resolved tracks = %#v", tracks)
	}
}

func TestPickBestArtistRequiresMatch(t *testing.T) {
	result := &spotify.SearchResponse{
		Artists: []spotify.Artist{
			{ID: "1", Name: "Totally Different"},
		},
	}
	if pickBestArtist("Exact Match", result) != nil {
		t.Fatal("expected nil for weak match")
	}
	result.Artists = []spotify.Artist{{ID: "2", Name: "Exact Match"}}
	got := pickBestArtist("Exact Match", result)
	if got == nil || got.ID != "2" {
		t.Fatalf("got %#v", got)
	}
}

type fakeSpotify struct {
	artists map[string]spotify.Artist
	tracks  map[string]spotify.TopTrack
}

func (f *fakeSpotify) Configured() bool { return true }

func (f *fakeSpotify) Search(_ context.Context, query string) (*spotify.SearchResponse, error) {
	out := &spotify.SearchResponse{}
	norm := normalizeName(query)
	for key, artist := range f.artists {
		if strings.Contains(norm, key) || strings.Contains(key, strings.TrimPrefix(norm, "artist ")) {
			out.Artists = append(out.Artists, artist)
		}
	}
	for key, track := range f.tracks {
		parts := strings.SplitN(key, "|", 2)
		if len(parts) != 2 {
			continue
		}
		if strings.Contains(norm, parts[0]) && strings.Contains(norm, parts[1]) {
			out.Tracks = append(out.Tracks, track)
		}
	}
	return out, nil
}

func countMethod(methods []string, want string) int {
	n := 0
	for _, m := range methods {
		if strings.EqualFold(m, want) {
			n++
		}
	}
	return n
}
