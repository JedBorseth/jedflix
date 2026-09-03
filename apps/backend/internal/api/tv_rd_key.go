package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jedborseth/jeds-movies/backend/internal/tvrdkey"
)

// Android TV Real Debrid pairing dropbox.
//
// Native app:
//  1. Generate a 16–128 char [A-Za-z0-9_-] code (32 random bytes, hex or base64url).
//  2. PUT  /api/v1/tv/rd-key/{code}     → 201
//  3. Show a QR for https://<site>/tv/rd/{code}
//  4. GET  /api/v1/tv/rd-key/{code}     long-poll (~25s). 200 {"apiKey":"..."} once;
//     retry on 204; 404 means expired/unknown.
//
// Phone page POSTs {"apiKey":"..."} to the same path. The key is never logged.

const tvRdKeyWaitDefault = 25 * time.Second

func (s *Server) handleTvRdKeyOpen(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if err := s.tvRdKey.Open(code); err != nil {
		writeTvRdKeyError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "pending"})
}

func (s *Server) handleTvRdKeyStatus(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if !tvrdkey.ValidCode(code) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid pairing code"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status": string(s.tvRdKey.Status(code)),
	})
}

func (s *Server) handleTvRdKeySubmit(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var body struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	code := chi.URLParam(r, "code")
	if err := s.tvRdKey.Submit(code, body.APIKey); err != nil {
		writeTvRdKeyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTvRdKeyWait(w http.ResponseWriter, r *http.Request) {
	wait := s.tvRdKeyWait
	if wait <= 0 {
		wait = tvRdKeyWaitDefault
	}
	ctx, cancel := context.WithTimeout(r.Context(), wait)
	defer cancel()

	code := chi.URLParam(r, "code")
	apiKey, err := s.tvRdKey.Wait(ctx, code)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeTvRdKeyError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"apiKey": apiKey})
}

func writeTvRdKeyError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, tvrdkey.ErrInvalidCode):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid pairing code"})
	case errors.Is(err, tvrdkey.ErrEmptyKey):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "api key is required"})
	case errors.Is(err, tvrdkey.ErrKeyTooLong):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "api key is too long"})
	case errors.Is(err, tvrdkey.ErrMissing):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pairing session not found"})
	case errors.Is(err, tvrdkey.ErrFilled):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "pairing session already has a key"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "pairing failed"})
	}
}

func redactTvRdKeyURI(uri string) string {
	path, query, hasQuery := strings.Cut(uri, "?")
	const prefix = "/api/v1/tv/rd-key/"
	if !strings.HasPrefix(path, prefix) {
		return uri
	}
	rest := strings.TrimPrefix(path, prefix)
	redacted := prefix + "REDACTED"
	if strings.HasSuffix(rest, "/status") {
		redacted += "/status"
	}
	if hasQuery {
		return redacted + "?" + query
	}
	return redacted
}
