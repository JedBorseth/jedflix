package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func tvRdKeyTestServer() *Server {
	server := NewServer(config.Config{
		CORSOrigins: []string{"http://localhost:5173"},
	}, nil, nil, nil, nil, nil, nil, nil)
	server.tvRdKeyWait = 40 * time.Millisecond
	return server
}

func TestTvRdKeyPairingFlow(t *testing.T) {
	server := tvRdKeyTestServer()
	router := server.Router()
	code := "tvpaircode1234567890"

	put := httptest.NewRequest(http.MethodPut, "/api/v1/tv/rd-key/"+code, nil)
	putRec := httptest.NewRecorder()
	router.ServeHTTP(putRec, put)
	if putRec.Code != http.StatusCreated {
		t.Fatalf("put status = %d body=%s", putRec.Code, putRec.Body.String())
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/api/v1/tv/rd-key/"+code+"/status", nil)
	statusRec := httptest.NewRecorder()
	router.ServeHTTP(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("status code = %d body=%s", statusRec.Code, statusRec.Body.String())
	}
	if !strings.Contains(statusRec.Body.String(), `"pending"`) {
		t.Fatalf("status body = %s", statusRec.Body.String())
	}

	post := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/tv/rd-key/"+code,
		strings.NewReader(`{"apiKey":"rd-from-phone"}`),
	)
	post.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	router.ServeHTTP(postRec, post)
	if postRec.Code != http.StatusNoContent {
		t.Fatalf("post status = %d body=%s", postRec.Code, postRec.Body.String())
	}

	get := httptest.NewRequest(http.MethodGet, "/api/v1/tv/rd-key/"+code, nil)
	getRec := httptest.NewRecorder()
	router.ServeHTTP(getRec, get)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status = %d body=%s", getRec.Code, getRec.Body.String())
	}
	var payload map[string]string
	if err := json.Unmarshal(getRec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload["apiKey"] != "rd-from-phone" {
		t.Fatalf("payload = %#v", payload)
	}

	second := httptest.NewRecorder()
	router.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/api/v1/tv/rd-key/"+code, nil))
	if second.Code != http.StatusNotFound {
		t.Fatalf("second get status = %d body=%s", second.Code, second.Body.String())
	}
}

func TestTvRdKeyWaitTimesOutWithNoContent(t *testing.T) {
	server := tvRdKeyTestServer()
	router := server.Router()
	code := "waitingforphonekey01"

	putRec := httptest.NewRecorder()
	router.ServeHTTP(putRec, httptest.NewRequest(http.MethodPut, "/api/v1/tv/rd-key/"+code, nil))
	if putRec.Code != http.StatusCreated {
		t.Fatalf("put status = %d", putRec.Code)
	}

	getRec := httptest.NewRecorder()
	router.ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/v1/tv/rd-key/"+code, nil))
	if getRec.Code != http.StatusNoContent {
		t.Fatalf("get status = %d body=%s", getRec.Code, getRec.Body.String())
	}
}

func TestTvRdKeyRejectsInvalidCode(t *testing.T) {
	server := tvRdKeyTestServer()
	router := server.Router()

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/v1/tv/rd-key/short", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestTvRdKeyStatusMissing(t *testing.T) {
	server := tvRdKeyTestServer()
	router := server.Router()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/tv/rd-key/missingcode1234567/status", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"missing"`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

func TestTvRdKeySubmitWithoutSlot(t *testing.T) {
	server := tvRdKeyTestServer()
	router := server.Router()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/tv/rd-key/noslotcode12345678",
		strings.NewReader(`{"apiKey":"secret"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRedactTvRdKeyURI(t *testing.T) {
	got := redactTvRdKeyURI("/api/v1/tv/rd-key/supersecretcode123/status")
	if got != "/api/v1/tv/rd-key/REDACTED/status" {
		t.Fatalf("got %q", got)
	}
	got = redactTvRdKeyURI("/api/v1/tv/rd-key/supersecretcode123")
	if got != "/api/v1/tv/rd-key/REDACTED" {
		t.Fatalf("got %q", got)
	}
	got = redactTvRdKeyURI("/api/v1/sources")
	if got != "/api/v1/sources" {
		t.Fatalf("got %q", got)
	}
}

func TestTvRdKeyCORSAllowsPut(t *testing.T) {
	server := tvRdKeyTestServer()
	router := server.Router()
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/tv/rd-key/corspreflightcode1", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", "PUT")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK && rec.Code != http.StatusNoContent {
		body, _ := io.ReadAll(rec.Body)
		t.Fatalf("status = %d body=%s", rec.Code, body)
	}
	if allow := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(allow, "PUT") {
		t.Fatalf("Allow-Methods = %q", allow)
	}
}
