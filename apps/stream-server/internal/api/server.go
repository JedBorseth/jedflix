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
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
	"github.com/jedborseth/jeds-movies/stream-server/internal/letterboxd"
	"github.com/jedborseth/jeds-movies/stream-server/internal/openlibrary"
	"github.com/jedborseth/jeds-movies/stream-server/internal/resolvejobs"
	"github.com/jedborseth/jeds-movies/stream-server/internal/resolver"
	"github.com/jedborseth/jeds-movies/stream-server/internal/spotify"
	"github.com/jedborseth/jeds-movies/stream-server/internal/youtube"
)

type Server struct {
	cfg         config.Config
	resolver    *resolver.Service
	jobs        *resolvejobs.Store
	letterboxd  *letterboxd.Client
	openLibrary *openlibrary.Client
	spotify     *spotify.Client
	youtube     *youtube.Resolver
}

func NewServer(
	cfg config.Config,
	resolverService *resolver.Service,
	letterboxdClient *letterboxd.Client,
	openLibraryClient *openlibrary.Client,
	spotifyClient *spotify.Client,
	youtubeResolver *youtube.Resolver,
) *Server {
	if youtubeResolver == nil {
		youtubeResolver = youtube.NewResolver()
	}
	return &Server{
		cfg:         cfg,
		resolver:    resolverService,
		jobs:        resolvejobs.NewStore(30 * time.Minute),
		letterboxd:  letterboxdClient,
		openLibrary: openLibraryClient,
		spotify:     spotifyClient,
		youtube:     youtubeResolver,
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "HEAD", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Range"},
		ExposedHeaders:   []string{"Content-Range", "Accept-Ranges", "Content-Length"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/health", s.handleHealth)

	// Cover/photo proxy is public so <img> tags work without an API key.
	// Upstream Open Library covers are already public; production still sits
	// behind Caddy. Cached images follow the same TTL/eviction as book data.
	r.Get("/api/v1/openlibrary/covers/b/id/{id}.jpg", s.handleOpenLibraryCover)
	r.Get("/api/v1/openlibrary/covers/a/id/{id}.jpg", s.handleOpenLibraryAuthorPhotoID)
	r.Get("/api/v1/openlibrary/covers/a/olid/{id}.jpg", s.handleOpenLibraryAuthorPhotoOLID)

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(s.authMiddleware)
		r.Post("/sources", s.handleSources)
		r.Post("/resolve", s.handleResolve)
		r.Get("/resolve/jobs/{jobId}", s.handleResolveJob)
		r.Get("/letterboxd/{username}/verify", s.handleLetterboxdVerify)
		r.Get("/letterboxd/{username}/films/by/date", s.handleLetterboxdFilmsByDate)
		r.Get("/openlibrary/browse", s.handleOpenLibraryBrowse)
		r.Get("/openlibrary/search", s.handleOpenLibrarySearch)
		r.Get("/openlibrary/works/{workId}", s.handleOpenLibraryWork)
		r.Get("/openlibrary/authors/{authorId}", s.handleOpenLibraryAuthor)
		r.Get("/spotify/browse", s.handleSpotifyBrowse)
		r.Get("/spotify/search", s.handleSpotifySearch)
		r.Get("/spotify/albums/{albumId}", s.handleSpotifyAlbum)
		r.Get("/spotify/artists/{artistId}", s.handleSpotifyArtist)
		r.Get("/youtube/audio", s.handleYouTubeAudio)
		r.Head("/youtube/audio", s.handleYouTubeAudio)
	})

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSources(w http.ResponseWriter, r *http.Request) {
	var req resolver.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.Type == "" {
		req.Type = "movie"
	}
	if req.PlaybackProfile == "" {
		req.PlaybackProfile = resolver.PlaybackBrowser
	}
	if token := bearerToken(r); token != "" {
		req.RealDebridToken = token
	}
	if (req.Type == "audiobook" || req.Type == "ebook") && strings.TrimSpace(req.Query) == "" {
		req.Query = strings.TrimSpace(strings.TrimSpace(req.Title) + " " + strings.TrimSpace(req.Author))
	}

	sources, err := s.resolver.ListSources(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": sources})
}

func (s *Server) handleResolve(w http.ResponseWriter, r *http.Request) {
	var req resolver.ResolveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.Type == "" {
		req.Type = "movie"
	}
	if req.PlaybackProfile == "" {
		req.PlaybackProfile = resolver.PlaybackBrowser
	}
	if token := bearerToken(r); token != "" {
		req.RealDebridToken = token
	}

	timeout := s.cfg.ResolveTimeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}

	// Async by default so mobile Safari does not kill long-lived resolve POSTs
	// ("Load failed") before Real Debrid is contacted.
	syncRequested := strings.EqualFold(r.URL.Query().Get("sync"), "1") ||
		strings.EqualFold(r.URL.Query().Get("sync"), "true")
	if !syncRequested {
		job := s.jobs.Start(timeout+30*time.Second, req, s.resolver.ResolveWithProgress)
		writeJSON(w, http.StatusAccepted, job)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), timeout+30*time.Second)
	defer cancel()

	result, err := s.resolver.Resolve(ctx, req)
	if err != nil {
		writeResolveError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleResolveJob(w http.ResponseWriter, r *http.Request) {
	jobID := strings.TrimSpace(chi.URLParam(r, "jobId"))
	if jobID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "jobId is required"})
		return
	}
	job, ok := s.jobs.Get(jobID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "resolve job not found", "code": "not_found"})
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func writeResolveError(w http.ResponseWriter, err error) {
	var resolveErr *resolver.ResolveError
	if errors.As(err, &resolveErr) {
		status := http.StatusBadRequest
		switch resolveErr.Code {
		case "missing_token":
			status = http.StatusUnauthorized
		case "timeout":
			status = http.StatusGatewayTimeout
		case "infringing_file":
			status = http.StatusUnavailableForLegalReasons
		case "rate_limited":
			status = http.StatusTooManyRequests
		case "magnet_error", "abb_magnet":
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"error": resolveErr.Message, "code": resolveErr.Code})
		return
	}
	if errors.Is(err, context.Canceled) {
		writeJSON(w, http.StatusRequestTimeout, map[string]string{"error": "resolve cancelled", "code": "cancelled"})
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		writeJSON(w, http.StatusGatewayTimeout, map[string]string{
			"error": "Real Debrid torrent timed out.",
			"code":  "timeout",
		})
		return
	}
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
}

func (s *Server) handleLetterboxdVerify(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, err := s.letterboxd.Verify(ctx, username)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	status := http.StatusOK
	if !result.Valid {
		status = http.StatusOK // still 200 with valid:false for client UX
	}
	writeJSON(w, status, result)
}

func (s *Server) handleLetterboxdFilmsByDate(w http.ResponseWriter, r *http.Request) {
	username := chi.URLParam(r, "username")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, err := s.letterboxd.FilmsByDate(ctx, username)
	if err != nil {
		status := http.StatusBadGateway
		switch {
		case errors.Is(err, letterboxd.ErrInvalidUsername):
			status = http.StatusBadRequest
		case errors.Is(err, letterboxd.ErrNotFound):
			status = http.StatusNotFound
		case errors.Is(err, letterboxd.ErrNoFilms):
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleOpenLibraryBrowse(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	result, err := s.openLibrary.Browse(ctx)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleOpenLibrarySearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.openLibrary.Search(ctx, query)
	if err != nil {
		writeOpenLibraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleOpenLibraryWork(w http.ResponseWriter, r *http.Request) {
	workID := chi.URLParam(r, "workId")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.openLibrary.GetWork(ctx, workID)
	if err != nil {
		writeOpenLibraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleOpenLibraryAuthor(w http.ResponseWriter, r *http.Request) {
	authorID := chi.URLParam(r, "authorId")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.openLibrary.GetAuthor(ctx, authorID)
	if err != nil {
		writeOpenLibraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleOpenLibraryCover(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid cover id"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	data, contentType, fetchErr := s.openLibrary.GetCoverImage(ctx, id)
	if fetchErr != nil {
		writeOpenLibraryError(w, fetchErr)
		return
	}
	writeImage(w, contentType, data)
}

func (s *Server) handleOpenLibraryAuthorPhotoID(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid photo id"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	data, contentType, fetchErr := s.openLibrary.GetAuthorPhotoByID(ctx, id)
	if fetchErr != nil {
		writeOpenLibraryError(w, fetchErr)
		return
	}
	writeImage(w, contentType, data)
}

func (s *Server) handleOpenLibraryAuthorPhotoOLID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	data, contentType, fetchErr := s.openLibrary.GetAuthorPhotoByOLID(ctx, id)
	if fetchErr != nil {
		writeOpenLibraryError(w, fetchErr)
		return
	}
	writeImage(w, contentType, data)
}

func (s *Server) handleSpotifyBrowse(w http.ResponseWriter, r *http.Request) {
	if s.spotify == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "spotify is not configured"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()

	result, err := s.spotify.Browse(ctx)
	if err != nil {
		writeSpotifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSpotifySearch(w http.ResponseWriter, r *http.Request) {
	if s.spotify == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "spotify is not configured"})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.spotify.Search(ctx, query)
	if err != nil {
		writeSpotifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSpotifyAlbum(w http.ResponseWriter, r *http.Request) {
	if s.spotify == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "spotify is not configured"})
		return
	}
	albumID := chi.URLParam(r, "albumId")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.spotify.GetAlbum(ctx, albumID)
	if err != nil {
		writeSpotifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSpotifyArtist(w http.ResponseWriter, r *http.Request) {
	if s.spotify == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "spotify is not configured"})
		return
	}
	artistID := chi.URLParam(r, "artistId")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.spotify.GetArtist(ctx, artistID)
	if err != nil {
		writeSpotifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleYouTubeAudio(w http.ResponseWriter, r *http.Request) {
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	title := strings.TrimSpace(r.URL.Query().Get("title"))
	album := strings.TrimSpace(r.URL.Query().Get("album"))
	durationMs := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("durationMs")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			durationMs = parsed
		}
	}
	if artist == "" || title == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "artist and title are required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), youtube.ResolveTimeout)
	defer cancel()

	info, err := s.youtube.Resolve(ctx, youtube.Request{
		Artist:     artist,
		Title:      title,
		Album:      album,
		DurationMs: durationMs,
	})
	if err != nil {
		writeYouTubeError(w, err)
		return
	}

	if err := youtube.Proxy(w, r, info); err != nil {
		// Headers may already be written while streaming; only report JSON if not.
		if !headersWritten(w) {
			writeYouTubeError(w, err)
		}
	}
}

func writeYouTubeError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, youtube.ErrBadRequest):
		status = http.StatusBadRequest
	case errors.Is(err, youtube.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, youtube.ErrYtdlpMissing):
		status = http.StatusServiceUnavailable
	case errors.Is(err, context.Canceled):
		status = http.StatusRequestTimeout
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func headersWritten(w http.ResponseWriter) bool {
	if rw, ok := w.(interface{ Written() bool }); ok {
		return rw.Written()
	}
	return false
}

func writeImage(w http.ResponseWriter, contentType string, data []byte) {
	if contentType == "" {
		contentType = "image/jpeg"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=43200") // 12h, matches OPEN_LIBRARY_CACHE_TTL default
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func writeOpenLibraryError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, openlibrary.ErrBadRequest):
		status = http.StatusBadRequest
	case errors.Is(err, openlibrary.ErrNotFound):
		status = http.StatusNotFound
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func writeSpotifyError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, spotify.ErrBadRequest):
		status = http.StatusBadRequest
	case errors.Is(err, spotify.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, spotify.ErrNotConfigured):
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.StreamServerAPIKey == "" {
			next.ServeHTTP(w, r)
			return
		}
		key := r.Header.Get("X-Api-Key")
		if key == "" {
			key = r.URL.Query().Get("apikey")
		}
		if key != s.cfg.StreamServerAPIKey {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func bearerToken(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	if value == "" {
		return ""
	}
	kind, token, ok := strings.Cut(value, " ")
	if !ok || !strings.EqualFold(kind, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}
