package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type ipRateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	rate     float64 // tokens per second
	burst    float64
}

type visitor struct {
	tokens float64
	last   time.Time
}

func newIPRateLimiter(rate, burst float64) *ipRateLimiter {
	l := &ipRateLimiter{
		visitors: make(map[string]*visitor),
		rate:     rate,
		burst:    burst,
	}
	go l.cleanup()
	return l
}

func (l *ipRateLimiter) allow(ip string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	v, ok := l.visitors[ip]
	if !ok {
		l.visitors[ip] = &visitor{tokens: l.burst - 1, last: now}
		return true
	}
	elapsed := now.Sub(v.last).Seconds()
	v.tokens = minFloat(l.burst, v.tokens+elapsed*l.rate)
	v.last = now
	if v.tokens < 1 {
		return false
	}
	v.tokens--
	return true
}

func (l *ipRateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		l.mu.Lock()
		cutoff := time.Now().Add(-15 * time.Minute)
		for ip, v := range l.visitors {
			if v.last.Before(cutoff) {
				delete(l.visitors, ip)
			}
		}
		l.mu.Unlock()
	}
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			ip := strings.TrimSpace(parts[0])
			if ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !s.limiter.allow(ip) {
			w.Header().Set("Retry-After", "1")
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expected := s.cfg.BackendAPIKey
		if expected == "" {
			if s.cfg.RequireAPIKey {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{
					"error": "backend api key is not configured",
				})
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		provided := r.Header.Get("X-Api-Key")
		if provided == "" {
			// Legacy query param for media elements; prefer header everywhere else.
			provided = r.URL.Query().Get("apikey")
		}
		if !apiKeysEqual(expected, provided) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func apiKeysEqual(expected, provided string) bool {
	if expected == "" || provided == "" {
		return false
	}
	// Hash to fixed length so ConstantTimeCompare always runs.
	a := sha256.Sum256([]byte(expected))
	b := sha256.Sum256([]byte(provided))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// redactLogger wraps chi's logger to strip secrets from request URIs.
func redactLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(ww, r)
		uri := r.URL.RequestURI()
		uri = redactQueryParam(uri, "apikey")
		uri = redactQueryParam(uri, "token")
		log.Printf("%s %s %d %s", r.Method, uri, ww.status, time.Since(start).Round(time.Millisecond))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func redactQueryParam(uri, key string) string {
	lowerKey := strings.ToLower(key)
	parts := strings.SplitN(uri, "?", 2)
	if len(parts) != 2 {
		return uri
	}
	pairs := strings.Split(parts[1], "&")
	for i, pair := range pairs {
		kv := strings.SplitN(pair, "=", 2)
		if strings.EqualFold(kv[0], lowerKey) {
			pairs[i] = kv[0] + "=REDACTED"
		}
	}
	return parts[0] + "?" + strings.Join(pairs, "&")
}
