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
	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/lastfm"
	"github.com/jedborseth/jeds-movies/backend/internal/letterboxd"
	"github.com/jedborseth/jeds-movies/backend/internal/openlibrary"
	"github.com/jedborseth/jeds-movies/backend/internal/resolvejobs"
	"github.com/jedborseth/jeds-movies/backend/internal/resolver"
	"github.com/jedborseth/jeds-movies/backend/internal/spotify"
	"github.com/jedborseth/jeds-movies/backend/internal/tmdb"
	"github.com/jedborseth/jeds-movies/backend/internal/youtube"
)

type Server struct {
	cfg         config.Config
	resolver    *resolver.Service
	jobs        *resolvejobs.Store
	letterboxd  *letterboxd.Client
	openLibrary *openlibrary.Client
	spotify     *spotify.Client
	lastfm      *lastfm.Service
	tmdb        *tmdb.Client
	youtube     *youtube.Resolver
	limiter     *ipRateLimiter
	resolveSem  chan struct{}
	youtubeSem  chan struct{}
}

func NewServer(
	cfg config.Config,
	resolverService *resolver.Service,
	letterboxdClient *letterboxd.Client,
	openLibraryClient *openlibrary.Client,
	spotifyClient *spotify.Client,
	lastfmService *lastfm.Service,
	youtubeResolver *youtube.Resolver,
	tmdbClient *tmdb.Client,
) *Server {
	if youtubeResolver == nil {
		youtubeResolver = youtube.NewResolver()
	}
	resolveSlots := cfg.MaxConcurrentResolves
	if resolveSlots <= 0 {
		resolveSlots = 6
	}
	youtubeSlots := cfg.MaxConcurrentYoutube
	if youtubeSlots <= 0 {
		youtubeSlots = 3
	}
	return &Server{
		cfg:         cfg,
		resolver:    resolverService,
		jobs:        resolvejobs.NewStore(30 * time.Minute),
		letterboxd:  letterboxdClient,
		openLibrary: openLibraryClient,
		spotify:     spotifyClient,
		lastfm:      lastfmService,
		tmdb:        tmdbClient,
		youtube:     youtubeResolver,
		limiter:     newIPRateLimiter(20, 40), // ~20 req/s sustained, burst 40
		resolveSem:  make(chan struct{}, resolveSlots),
		youtubeSem:  make(chan struct{}, youtubeSlots),
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(redactLogger)
	r.Use(middleware.Recoverer)
	r.Use(s.rateLimitMiddleware)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "HEAD", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Range"},
		ExposedHeaders:   []string{"Content-Range", "Accept-Ranges", "Content-Length"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/health", s.handleHealth)

	// Cover/photo proxy is public so <img> tags work without cookies/headers.
	// Upstream Open Library covers are already public; production still sits
	// behind Caddy. Cached images follow the same TTL/eviction as book data.
	r.Get("/api/v1/openlibrary/covers/b/id/{id}.jpg", s.handleOpenLibraryCover)
	r.Get("/api/v1/openlibrary/covers/a/id/{id}.jpg", s.handleOpenLibraryAuthorPhotoID)
	r.Get("/api/v1/openlibrary/covers/a/olid/{id}.jpg", s.handleOpenLibraryAuthorPhotoOLID)

	r.Route("/api/v1", func(r chi.Router) {
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
		r.Get("/lastfm/similar-artists", s.handleLastFMSimilarArtists)
		r.Get("/lastfm/similar-tracks", s.handleLastFMSimilarTracks)
		r.Get("/lastfm/artist-tags", s.handleLastFMArtistTags)
		r.Get("/lastfm/related", s.handleLastFMRelated)
		r.Get("/tmdb/*", s.handleTmdbProxy)
		r.Get("/youtube/search", s.handleYouTubeSearch)
		r.Get("/youtube/audio", s.handleYouTubeAudio)
		r.Head("/youtube/audio", s.handleYouTubeAudio)
	})

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSources(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	// Prefer Authorization header; ignore body token to avoid accidental logging.
	req.RealDebridToken = ""
	if token := bearerToken(r); token != "" {
		req.RealDebridToken = token
	}
	if (req.Type == "audiobook" || req.Type == "ebook") && strings.TrimSpace(req.Query) == "" {
		req.Query = strings.TrimSpace(strings.TrimSpace(req.Title) + " " + strings.TrimSpace(req.Author))
	}

	sources, err := s.resolver.ListSources(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unable to list sources"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": sources})
}

func (s *Server) handleResolve(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
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
	req.RealDebridToken = ""
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
		if !s.tryAcquire(s.resolveSem) {
			w.Header().Set("Retry-After", "5")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error": "too many resolve jobs in progress",
				"code":  "rate_limited",
			})
			return
		}
		job := s.jobs.Start(timeout+30*time.Second, req, func(
			ctx context.Context,
			resolveReq resolver.ResolveRequest,
			onProgress func(string),
		) (*resolver.StreamResult, error) {
			defer s.release(s.resolveSem)
			return s.resolver.ResolveWithProgress(ctx, resolveReq, onProgress)
		})
		writeJSON(w, http.StatusAccepted, job)
		return
	}

	if !s.tryAcquire(s.resolveSem) {
		w.Header().Set("Retry-After", "5")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{
			"error": "too many resolve jobs in progress",
			"code":  "rate_limited",
		})
		return
	}
	defer s.release(s.resolveSem)

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
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": "resolve failed", "code": "resolve_failed"})
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

func (s *Server) handleTmdbProxy(w http.ResponseWriter, r *http.Request) {
	if s.tmdb == nil || !s.tmdb.Configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "tmdb is not configured"})
		return
	}
	path := chi.URLParam(r, "*")
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	result, err := s.tmdb.ProxyGET(ctx, path, r.URL.Query())
	if err != nil {
		msg := err.Error()
		status := http.StatusBadGateway
		if strings.Contains(msg, "invalid tmdb path") || strings.Contains(msg, "missing tmdb path") {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"error": "tmdb request failed"})
		return
	}
	if result.StatusCode >= 200 && result.StatusCode < 400 {
		w.Header().Set("Cache-Control", "public, max-age=300")
	}
	w.Header().Set("Content-Type", result.ContentType)
	w.WriteHeader(result.StatusCode)
	_, _ = w.Write(result.Body)
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
	hints := spotify.AlbumHints{
		Name: strings.TrimSpace(r.URL.Query().Get("name")),
	}
	if artists := strings.TrimSpace(r.URL.Query().Get("artist")); artists != "" {
		hints.Artists = []string{artists}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.spotify.GetAlbumWithHints(ctx, albumID, hints)
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
	hints := spotify.ArtistHints{
		Name: strings.TrimSpace(r.URL.Query().Get("name")),
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	result, err := s.spotify.GetArtistWithHints(ctx, artistID, hints)
	if err != nil {
		writeSpotifyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleLastFMSimilarArtists(w http.ResponseWriter, r *http.Request) {
	if s.lastfm == nil || !s.lastfm.Configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "last.fm is not configured"})
		return
	}
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 12)
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
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
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 16)
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
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
	if s.lastfm == nil || !s.lastfm.Configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "last.fm is not configured"})
		return
	}
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 12)
	seeds := make([]struct{ Artist, Track string }, 0)
	for _, raw := range r.URL.Query()["seed"] {
		artistName, trackName, ok := splitSeed(raw)
		if !ok {
			continue
		}
		seeds = append(seeds, struct{ Artist, Track string }{Artist: artistName, Track: trackName})
	}
	// Also accept a single track= + artist= pair as a seed.
	if track := strings.TrimSpace(r.URL.Query().Get("track")); track != "" && artist != "" {
		seeds = append([]struct{ Artist, Track string }{{Artist: artist, Track: track}}, seeds...)
	}

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	artists, tracks, err := s.lastfm.RelatedForAlbum(ctx, artist, seeds, limit)
	if err != nil {
		writeLastFMError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"artists": artists,
		"tracks":  tracks,
	})
}

func (s *Server) handleYouTubeSearch(w http.ResponseWriter, r *http.Request) {
	if !s.tryAcquire(s.youtubeSem) {
		w.Header().Set("Retry-After", "3")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "youtube busy"})
		return
	}
	defer s.release(s.youtubeSem)

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	ctx, cancel := context.WithTimeout(r.Context(), youtube.ResolveTimeout)
	defer cancel()

	result, err := s.youtube.Search(ctx, query)
	if err != nil {
		writeYouTubeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleYouTubeAudio(w http.ResponseWriter, r *http.Request) {
	if !s.tryAcquire(s.youtubeSem) {
		w.Header().Set("Retry-After", "3")
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "youtube busy"})
		return
	}
	defer s.release(s.youtubeSem)

	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	title := strings.TrimSpace(r.URL.Query().Get("title"))
	album := strings.TrimSpace(r.URL.Query().Get("album"))
	videoID := strings.TrimSpace(r.URL.Query().Get("videoId"))
	durationMs := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("durationMs")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			durationMs = parsed
		}
	}
	if videoID == "" && (artist == "" || title == "") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "artist and title are required (or videoId)"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), youtube.ResolveTimeout)
	defer cancel()

	info, err := s.youtube.Resolve(ctx, youtube.Request{
		Artist:     artist,
		Title:      title,
		Album:      album,
		DurationMs: durationMs,
		VideoID:    videoID,
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
	message := "youtube audio unavailable"
	switch {
	case errors.Is(err, youtube.ErrBadRequest):
		status = http.StatusBadRequest
		message = "invalid youtube request"
	case errors.Is(err, youtube.ErrNotFound):
		status = http.StatusNotFound
		message = "youtube audio not found"
	case errors.Is(err, youtube.ErrYtdlpMissing):
		status = http.StatusServiceUnavailable
		message = "youtube resolver unavailable"
	case errors.Is(err, context.Canceled):
		status = http.StatusRequestTimeout
		message = "request cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
		message = "youtube resolve timed out"
	}
	writeJSON(w, status, map[string]string{"error": message})
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
	message := "open library request failed"
	switch {
	case errors.Is(err, openlibrary.ErrBadRequest):
		status = http.StatusBadRequest
		message = "invalid open library request"
	case errors.Is(err, openlibrary.ErrNotFound):
		status = http.StatusNotFound
		message = "open library resource not found"
	}
	writeJSON(w, status, map[string]string{"error": message})
}

func writeSpotifyError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	message := "spotify request failed"
	switch {
	case errors.Is(err, spotify.ErrBadRequest):
		status = http.StatusBadRequest
		message = "invalid spotify request"
	case errors.Is(err, spotify.ErrNotFound):
		status = http.StatusNotFound
		message = "spotify resource not found"
	case errors.Is(err, spotify.ErrNotConfigured):
		status = http.StatusServiceUnavailable
		message = "spotify is not configured"
	case errors.Is(err, spotify.ErrRateLimited):
		status = http.StatusTooManyRequests
		message = "spotify rate limited"
		w.Header().Set("Retry-After", "5")
	default:
		// Include upstream detail for ops (still safe — no secrets).
		if err != nil {
			detail := err.Error()
			if idx := strings.LastIndex(detail, "status "); idx >= 0 {
				message = "spotify request failed (" + detail[idx:] + ")"
			}
		}
	}
	writeJSON(w, status, map[string]string{"error": message})
}

func writeLastFMError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, lastfm.ErrBadRequest):
		status = http.StatusBadRequest
	case errors.Is(err, lastfm.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, lastfm.ErrNotConfigured):
		status = http.StatusServiceUnavailable
	case errors.Is(err, context.Canceled):
		status = http.StatusRequestTimeout
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
	}
	writeJSON(w, status, map[string]string{"error": err.Error()})
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

// splitSeed parses "Artist|||Track" seed pairs from query params.
func splitSeed(raw string) (artist, track string, ok bool) {
	parts := strings.SplitN(raw, "|||", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	artist = strings.TrimSpace(parts[0])
	track = strings.TrimSpace(parts[1])
	if artist == "" || track == "" {
		return "", "", false
	}
	return artist, track, true
}

func (s *Server) tryAcquire(sem chan struct{}) bool {
	select {
	case sem <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s *Server) release(sem chan struct{}) {
	select {
	case <-sem:
	default:
	}
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
