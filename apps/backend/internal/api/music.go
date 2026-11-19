package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jedborseth/jeds-movies/backend/internal/lastfm"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
	"github.com/jedborseth/jeds-movies/backend/internal/musicrec"
)

func (s *Server) handleSpotifyBrowse(w http.ResponseWriter, r *http.Request) {
	if s.music == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "music catalog is not configured"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	result, err := s.music.Browse(ctx)
	if err != nil {
		writeMusicCatalogError(w, err)
		return
	}
	if result != nil {
		albums := append([]musiccatalog.Album{}, result.NewReleases...)
		artists := make([]musiccatalog.Artist, 0)
		for _, row := range result.Rows {
			albums = append(albums, row.Albums...)
			artists = append(artists, row.Artists...)
		}
		s.music.WarmArtworkAsync(ctx, albums, nil, artists)
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSpotifySearch(w http.ResponseWriter, r *http.Request) {
	if s.music == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "music catalog is not configured"})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.music.Search(ctx, query)
	if err != nil {
		writeMusicCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSpotifyAlbum(w http.ResponseWriter, r *http.Request) {
	if s.music == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "music catalog is not configured"})
		return
	}
	albumID := chi.URLParam(r, "albumId")
	hints := musiccatalog.AlbumHints{
		Name: strings.TrimSpace(r.URL.Query().Get("name")),
	}
	if artists := strings.TrimSpace(r.URL.Query().Get("artist")); artists != "" {
		hints.Artists = []string{artists}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.music.GetAlbumWithHints(ctx, albumID, hints)
	if err != nil {
		writeMusicCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSpotifyArtist(w http.ResponseWriter, r *http.Request) {
	if s.music == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "music catalog is not configured"})
		return
	}
	artistID := chi.URLParam(r, "artistId")
	hints := musiccatalog.ArtistHints{
		Name: strings.TrimSpace(r.URL.Query().Get("name")),
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.music.GetArtistWithHints(ctx, artistID, hints)
	if err != nil {
		writeMusicCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSpotifyArtistAlbums(w http.ResponseWriter, r *http.Request) {
	if s.music == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "music catalog is not configured"})
		return
	}
	artistID := chi.URLParam(r, "artistId")
	hints := musiccatalog.ArtistHints{
		Name: strings.TrimSpace(r.URL.Query().Get("name")),
	}
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 10)
	if limit > 25 {
		limit = 25
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	albums, err := s.music.ListArtistAlbums(ctx, artistID, limit, hints)
	if err != nil {
		writeMusicCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"albums": albums})
}

func (s *Server) handleLastFMSimilarArtists(w http.ResponseWriter, r *http.Request) {
	if s.lastfm == nil || !s.lastfm.Configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "last.fm is not configured"})
		return
	}
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 6)
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	artists, err := s.lastfm.SimilarArtists(ctx, artist, limit)
	if err != nil {
		writeLastFMError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"artists": artists})
}

func (s *Server) handleLastFMSimilarTracks(w http.ResponseWriter, r *http.Request) {
	if s.lastfm == nil || !s.lastfm.Configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "last.fm is not configured"})
		return
	}
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	track := strings.TrimSpace(r.URL.Query().Get("track"))
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 8)
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()

	tracks, err := s.lastfm.SimilarTracks(ctx, artist, track, limit)
	if err != nil {
		writeLastFMError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (s *Server) handleLastFMArtistTags(w http.ResponseWriter, r *http.Request) {
	if s.lastfm == nil || !s.lastfm.Configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "last.fm is not configured"})
		return
	}
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	tags, err := s.lastfm.ArtistTags(ctx, artist)
	if err != nil {
		writeLastFMError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

func (s *Server) handleLastFMRelated(w http.ResponseWriter, r *http.Request) {
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 6)
	seeds := make([]struct{ Artist, Track string }, 0)
	for _, raw := range r.URL.Query()["seed"] {
		artistName, trackName, _, ok := splitSeed(raw)
		if !ok {
			continue
		}
		seeds = append(seeds, struct{ Artist, Track string }{Artist: artistName, Track: trackName})
	}
	if track := strings.TrimSpace(r.URL.Query().Get("track")); track != "" && artist != "" {
		seeds = append([]struct{ Artist, Track string }{{Artist: artist, Track: track}}, seeds...)
	}

	if s.lastfm == nil || !s.lastfm.Configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "last.fm is not configured"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	artists, tracks, err := s.lastfm.RelatedForAlbum(ctx, artist, seeds, limit)
	if err != nil && len(artists) == 0 {
		writeLastFMError(w, err)
		return
	}
	if artists == nil {
		artists = []musiccatalog.Artist{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"artists": artists,
		"tracks":  tracks,
	})
}

func (s *Server) handleMusicRecommend(w http.ResponseWriter, r *http.Request) {
	if s.recommender == nil || !s.recommender.Configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "music recommendations are not configured"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req musicrec.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	result, err := s.recommender.Recommend(ctx, req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if s.music != nil && result != nil {
		result.Tracks = s.music.EnrichTracks(ctx, result.Tracks)
	}
	writeJSON(w, http.StatusOK, result)
}

func writeMusicCatalogError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	message := "music catalog request failed"
	switch {
	case errors.Is(err, musiccatalog.ErrBadRequest):
		status = http.StatusBadRequest
		message = "invalid music catalog request"
	case errors.Is(err, musiccatalog.ErrNotFound):
		status = http.StatusNotFound
		message = "music catalog resource not found"
	case errors.Is(err, musiccatalog.ErrNotConfigured):
		status = http.StatusServiceUnavailable
		message = "music catalog is not configured"
	case errors.Is(err, musiccatalog.ErrRateLimited):
		status = http.StatusTooManyRequests
		message = "music catalog rate limited — retrying usually helps"
		w.Header().Set("Retry-After", "2")
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
		message = "music catalog timed out"
	default:
		if err != nil {
			detail := err.Error()
			if idx := strings.LastIndex(detail, "status "); idx >= 0 {
				message = "music catalog request failed (" + detail[idx:] + ")"
			} else if strings.Contains(detail, "empty catalog") {
				message = "music catalog temporarily unavailable"
			}
		}
	}
	writeJSON(w, status, map[string]string{"error": message})
}

func writeLastFMError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	message := "last.fm request failed"
	switch {
	case errors.Is(err, lastfm.ErrBadRequest):
		status = http.StatusBadRequest
		message = "invalid last.fm request"
	case errors.Is(err, lastfm.ErrNotFound):
		status = http.StatusNotFound
		message = "last.fm resource not found"
	case errors.Is(err, lastfm.ErrNotConfigured):
		status = http.StatusServiceUnavailable
		message = "last.fm is not configured"
	case errors.Is(err, context.Canceled):
		status = http.StatusRequestTimeout
		message = "last.fm request canceled"
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
		message = "last.fm request timed out"
	}
	writeJSON(w, status, map[string]string{"error": message})
}

func parsePositiveInt(raw string, fallback int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

// splitSeed parses "Artist|||Track" or "Artist|||Track|||MBID" seed pairs.
func splitSeed(raw string) (artist, track, id string, ok bool) {
	parts := strings.Split(raw, "|||")
	if len(parts) < 2 {
		return "", "", "", false
	}
	artist = strings.TrimSpace(parts[0])
	track = strings.TrimSpace(parts[1])
	if len(parts) >= 3 {
		id = strings.TrimSpace(parts[2])
	}
	if artist == "" || track == "" {
		return "", "", "", false
	}
	return artist, track, id, true
}
