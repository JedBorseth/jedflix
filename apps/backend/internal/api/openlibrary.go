package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jedborseth/jeds-movies/backend/internal/openlibrary"
)

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
