package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jedborseth/jeds-movies/backend/internal/letterboxd"
)

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
