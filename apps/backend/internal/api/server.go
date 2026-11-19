package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/demord"
	"github.com/jedborseth/jeds-movies/backend/internal/lastfm"
	"github.com/jedborseth/jeds-movies/backend/internal/letterboxd"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz"
	"github.com/jedborseth/jeds-movies/backend/internal/musicrec"
	"github.com/jedborseth/jeds-movies/backend/internal/openlibrary"
	"github.com/jedborseth/jeds-movies/backend/internal/resolvejobs"
	"github.com/jedborseth/jeds-movies/backend/internal/resolver"
	"github.com/jedborseth/jeds-movies/backend/internal/tmdb"
	"github.com/jedborseth/jeds-movies/backend/internal/tvrdkey"
	"github.com/jedborseth/jeds-movies/backend/internal/youtube"
)

type Server struct {
	cfg         config.Config
	resolver    *resolver.Service
	jobs        *resolvejobs.Store
	letterboxd  *letterboxd.Client
	openLibrary *openlibrary.Client
	music       *musicbrainz.Client
	lastfm      *lastfm.Service
	recommender *musicrec.Service
	tmdb        *tmdb.Client
	youtube     *youtube.Resolver
	limiter     *ipRateLimiter
	resolveSem  chan struct{}
	demoRd      *demord.Gate
	tvRdKey     *tvrdkey.Store
	tvRdKeyWait time.Duration
}

func NewServer(
	cfg config.Config,
	resolverService *resolver.Service,
	letterboxdClient *letterboxd.Client,
	openLibraryClient *openlibrary.Client,
	musicClient *musicbrainz.Client,
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
	return &Server{
		cfg:         cfg,
		resolver:    resolverService,
		jobs:        resolvejobs.NewStore(30 * time.Minute),
		letterboxd:  letterboxdClient,
		openLibrary: openLibraryClient,
		music:       musicClient,
		lastfm:      lastfmService,
		tmdb:        tmdbClient,
		youtube:     youtubeResolver,
		limiter:     newIPRateLimiter(20, 40), // ~20 req/s sustained, burst 40
		resolveSem:  make(chan struct{}, resolveSlots),
		demoRd: &demord.Gate{
			ClientKey: cfg.RealDebridDemoClientKey,
			ServerKey: cfg.RealDebridDemoAPIKey,
			Store:     demord.NewStore(cfg.DemoRdPlaysPath, cfg.DemoRdPlayLimit),
		},
		tvRdKey:     tvrdkey.NewStore(tvrdkey.DefaultTTL),
		tvRdKeyWait: tvRdKeyWaitDefault,
	}
}

func (s *Server) SetRecommender(rec *musicrec.Service) {
	if s == nil {
		return
	}
	s.recommender = rec
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
		AllowedMethods:   []string{"GET", "HEAD", "POST", "PUT", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Range", demord.UserHeader},
		ExposedHeaders:   []string{"Content-Range", "Accept-Ranges", "Content-Length", "Content-Type", "X-Audio-Duration-Ms", "X-Audio-Ext"},
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
	// Music Cover Art Archive proxy — lazy disk cache under MUSIC_ARTWORK_PATH.
	r.Get("/api/v1/music/covers/release-group/{mbid}.jpg", s.handleMusicReleaseGroupCover)
	r.Get("/api/v1/music/covers/artist/{mbid}.jpg", s.handleMusicArtistCover)

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/sources", s.handleSources)
		r.Post("/resolve", s.handleResolve)
		r.Get("/demo-rd/status", s.handleDemoRdStatus)
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
		r.Get("/spotify/artists/{artistId}/albums", s.handleSpotifyArtistAlbums)
		r.Get("/spotify/artists/{artistId}", s.handleSpotifyArtist)
		r.Get("/lastfm/similar-artists", s.handleLastFMSimilarArtists)
		r.Get("/lastfm/similar-tracks", s.handleLastFMSimilarTracks)
		r.Get("/lastfm/artist-tags", s.handleLastFMArtistTags)
		r.Get("/lastfm/related", s.handleLastFMRelated)
		r.Post("/music/recommend", s.handleMusicRecommend)
		r.Get("/tmdb/*", s.handleTmdbProxy)
		r.Get("/youtube/search", s.handleYouTubeSearch)
		r.Get("/youtube/audio", s.handleYouTubeAudio)
		r.Head("/youtube/audio", s.handleYouTubeAudio)
		r.Route("/tv/rd-key/{code}", func(r chi.Router) {
			r.Put("/", s.handleTvRdKeyOpen)
			r.Get("/", s.handleTvRdKeyWait)
			r.Post("/", s.handleTvRdKeySubmit)
			r.Get("/status", s.handleTvRdKeyStatus)
		})
	})

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
