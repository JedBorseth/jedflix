package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

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

func (s *Server) handleMusicReleaseGroupCover(w http.ResponseWriter, r *http.Request) {
	if s.music == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "music catalog is not configured"})
		return
	}
	mbid := chi.URLParam(r, "mbid")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	data, contentType, err := s.music.GetReleaseGroupCover(ctx, mbid)
	if err != nil {
		writeMusicCatalogError(w, err)
		return
	}
	// Permanent-ish browser cache; disk cache is permanent on the server.
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) handleMusicArtistCover(w http.ResponseWriter, r *http.Request) {
	if s.music == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "music catalog is not configured"})
		return
	}
	mbid := chi.URLParam(r, "mbid")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	data, contentType, err := s.music.GetArtistCover(ctx, mbid)
	if err != nil {
		writeMusicCatalogError(w, err)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
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
