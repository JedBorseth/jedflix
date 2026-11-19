package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

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
