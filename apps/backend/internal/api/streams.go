package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jedborseth/jeds-movies/backend/internal/abb"
	"github.com/jedborseth/jeds-movies/backend/internal/resolver"
)

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
	rewritten, ok := s.applyDemoRealDebrid(w, r, req.RealDebridToken, req.Type, false)
	if !ok {
		return
	}
	req.RealDebridToken = rewritten
	if (req.Type == "audiobook" || req.Type == "ebook") && strings.TrimSpace(req.Query) == "" {
		req.Query = strings.TrimSpace(strings.TrimSpace(req.Title) + " " + strings.TrimSpace(req.Author))
	}

	sources, err := s.resolver.ListSources(r.Context(), req)
	if err != nil {
		var fetchErr *abb.FetchError
		if errors.As(err, &fetchErr) {
			status := http.StatusServiceUnavailable
			code := "abb_unavailable"
			message := "AudiobookBay is temporarily unreachable. Please try again shortly."
			switch fetchErr.StatusCode {
			case http.StatusTooManyRequests:
				status = http.StatusTooManyRequests
				code = "abb_rate_limited"
				message = "AudiobookBay is rate limiting searches. Please wait before trying again."
			case http.StatusForbidden, http.StatusUnauthorized:
				status = http.StatusBadGateway
				code = "abb_blocked"
				message = "AudiobookBay is blocking search requests. Please try again later."
			}
			log.Printf("source listing failed: provider=abb code=%s upstream_status=%d", code, fetchErr.StatusCode)
			writeJSON(w, status, map[string]string{"error": message, "code": code})
			return
		}
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
	rewritten, ok := s.applyDemoRealDebrid(w, r, req.RealDebridToken, req.Type, false)
	if !ok {
		return
	}
	req.RealDebridToken = rewritten

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
		if !s.consumeDemoPlay(w, r, req.Type) {
			s.release(s.resolveSem)
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
	if !s.consumeDemoPlay(w, r, req.Type) {
		s.release(s.resolveSem)
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
		case "demo_limit_reached":
			status = http.StatusForbidden
		case "demo_unavailable":
			status = http.StatusServiceUnavailable
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
