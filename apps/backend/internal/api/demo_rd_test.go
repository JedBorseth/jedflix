package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/demord"
)

const demoTestClientKey = "demo-client-test-key"

func demoTestServer() *Server {
	cfg := config.Config{
		CORSOrigins:             []string{"http://localhost:5173"},
		RealDebridDemoClientKey: demoTestClientKey,
		RealDebridDemoAPIKey:    "server-secret",
		DemoRdPlayLimit:         5,
	}
	return NewServer(cfg, nil, nil, nil, nil, nil, nil, nil)
}

func TestApplyDemoRealDebridSwapsAndLocks(t *testing.T) {
	server := demoTestServer()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/resolve", nil)
	req.Header.Set(demord.UserHeader, "user-1")

	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		token, ok := server.applyDemoRealDebrid(rec, req, demoTestClientKey, "movie", true)
		if !ok || token != "server-secret" {
			t.Fatalf("play %d: ok=%v token=%q status=%d body=%s", i+1, ok, token, rec.Code, rec.Body.String())
		}
	}

	rec := httptest.NewRecorder()
	token, ok := server.applyDemoRealDebrid(rec, req, demoTestClientKey, "audiobook", true)
	if ok || token != "" {
		t.Fatalf("lockout should fail, ok=%v token=%q", ok, token)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	passthrough, ok := server.applyDemoRealDebrid(httptest.NewRecorder(), req, "personal-key", "movie", true)
	if !ok || passthrough != "personal-key" {
		t.Fatalf("personal key should pass through, ok=%v token=%q", ok, passthrough)
	}
}

func TestApplyDemoRealDebridUnavailable(t *testing.T) {
	server := NewServer(config.Config{
		CORSOrigins:             []string{"*"},
		RealDebridDemoClientKey: demoTestClientKey,
	}, nil, nil, nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sources", nil)
	rec := httptest.NewRecorder()
	_, ok := server.applyDemoRealDebrid(rec, req, demoTestClientKey, "tv", false)
	if ok || rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("ok=%v status=%d body=%s", ok, rec.Code, rec.Body.String())
	}
}

func TestHandleDemoRdStatus(t *testing.T) {
	server := demoTestServer()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/demo-rd/status", nil)
	req.Header.Set("Authorization", "Bearer "+demoTestClientKey)
	req.Header.Set(demord.UserHeader, "user-1")
	rec := httptest.NewRecorder()
	server.handleDemoRdStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"demo":true`) {
		t.Fatalf("body = %s", rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/demo-rd/status", nil)
	req.Header.Set("Authorization", "Bearer personal-key")
	rec = httptest.NewRecorder()
	server.handleDemoRdStatus(rec, req)
	if !strings.Contains(rec.Body.String(), `"demo":false`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
}
