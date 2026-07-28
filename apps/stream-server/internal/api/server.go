package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
	"github.com/jedborseth/jeds-movies/stream-server/internal/letterboxd"
	"github.com/jedborseth/jeds-movies/stream-server/internal/resolver"
)

type Server struct {
	cfg        config.Config
	resolver   *resolver.Service
	letterboxd *letterboxd.Client
}

func NewServer(cfg config.Config, resolverService *resolver.Service, letterboxdClient *letterboxd.Client) *Server {
	return &Server{
		cfg:        cfg,
		resolver:   resolverService,
		letterboxd: letterboxdClient,
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
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(s.authMiddleware)
		r.Post("/sources", s.handleSources)
		r.Get("/letterboxd/{username}/verify", s.handleLetterboxdVerify)
		r.Get("/letterboxd/{username}/films/by/date", s.handleLetterboxdFilmsByDate)
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

	sources, err := s.resolver.ListSources(req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": sources})
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
