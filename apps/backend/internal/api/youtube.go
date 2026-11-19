package api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/youtube"
)

func (s *Server) handleYouTubeSearch(w http.ResponseWriter, r *http.Request) {
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

	req := youtube.Request{
		Artist:     artist,
		Title:      title,
		Album:      album,
		DurationMs: durationMs,
		VideoID:    videoID,
		Prefetch:   strings.TrimSpace(r.URL.Query().Get("prefetch")) == "1",
	}
	if strings.TrimSpace(r.URL.Query().Get("fresh")) == "1" {
		s.youtube.Invalidate(req)
	}

	ctx, cancel := context.WithTimeout(r.Context(), youtube.ResolveTimeout)
	defer cancel()

	info, err := s.youtube.Resolve(ctx, req)
	if err != nil {
		writeYouTubeError(w, err)
		return
	}

	if r.Method == http.MethodHead {
		youtube.WriteMetadataHeaders(w, info)
		w.Header().Set("Access-Control-Expose-Headers", youtube.ExposedAudioHeaders())
		w.WriteHeader(http.StatusOK)
		return
	}

	if err := youtube.Proxy(w, r, info); err != nil {
		if !headersWritten(w) && youtube.IsRetryableProxyError(err) {
			s.youtube.Invalidate(req)
			retryCtx, retryCancel := context.WithTimeout(r.Context(), youtube.ResolveTimeout)
			defer retryCancel()
			retried, retryErr := s.youtube.Resolve(retryCtx, req)
			if retryErr == nil {
				if proxyErr := youtube.Proxy(w, r, retried); proxyErr == nil {
					return
				} else {
					err = proxyErr
				}
			} else {
				err = retryErr
			}
		}
		// Headers may already be written while streaming; only report JSON if not.
		if !headersWritten(w) {
			writeYouTubeError(w, err)
		}
	}
}

func writeYouTubeError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	message := "youtube audio unavailable"
	if err != nil {
		log.Printf("youtube audio error: %v", err)
	}
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
