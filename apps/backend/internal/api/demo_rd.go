package api

import (
	"errors"
	"net/http"

	"github.com/jedborseth/jeds-movies/backend/internal/demord"
)

func (s *Server) applyDemoRealDebrid(
	w http.ResponseWriter,
	r *http.Request,
	token string,
	mediaType string,
	consume bool,
) (string, bool) {
	if s == nil || s.demoRd == nil || !s.demoRd.IsClientToken(token) {
		return token, true
	}
	userID := demord.UserID(r, clientIP(r))
	rewritten, err := s.demoRd.Apply(token, mediaType, userID, consume)
	if err == nil {
		return rewritten, true
	}
	writeDemoRealDebridError(w, err)
	return "", false
}

func writeDemoRealDebridError(w http.ResponseWriter, err error) {
	if errors.Is(err, demord.ErrUnavailable) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": demord.UnavailableMessage,
			"code":  "demo_unavailable",
		})
		return
	}
	if errors.Is(err, demord.ErrLimitReached) {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": demord.LimitReachedMessage,
			"code":  "demo_limit_reached",
		})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{
		"error": "demo Real Debrid failed",
		"code":  "demo_unavailable",
	})
}

func (s *Server) consumeDemoPlay(w http.ResponseWriter, r *http.Request, mediaType string) bool {
	if s == nil || s.demoRd == nil || !s.demoRd.IsClientToken(bearerToken(r)) {
		return true
	}
	if !demord.CountsAsPlay(mediaType) {
		return true
	}
	userID := demord.UserID(r, clientIP(r))
	if s.demoRd.Store == nil {
		s.demoRd.Store = demord.NewStore("", demord.DefaultPlayLimit)
	}
	if err := s.demoRd.Store.Consume(userID); err != nil {
		writeDemoRealDebridError(w, err)
		return false
	}
	return true
}

func (s *Server) handleDemoRdStatus(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" || s.demoRd == nil || !s.demoRd.IsClientToken(token) {
		writeJSON(w, http.StatusOK, map[string]any{"demo": false})
		return
	}
	if !s.demoRd.Configured() {
		writeJSON(w, http.StatusOK, map[string]any{"demo": false})
		return
	}
	userID := demord.UserID(r, clientIP(r))
	remaining := s.demoRd.Store.Remaining(userID)
	limit := s.cfg.DemoRdPlayLimit
	if limit <= 0 {
		limit = demord.DefaultPlayLimit
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"demo":      true,
		"remaining": remaining,
		"playLimit": limit,
	})
}
