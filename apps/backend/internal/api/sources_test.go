package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/abb"
	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/resolver"
)

type abbSourceTransport struct {
	status int
}

func (transport abbSourceTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if transport.status == 0 {
		return nil, errors.New("SOCKS5 connection failed: private diagnostic details")
	}
	return &http.Response{
		StatusCode: transport.status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader("private upstream response")),
		Request:    req,
	}, nil
}

func TestAudiobookSourceErrorsIdentifyUpstreamFailure(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		want   int
		code   string
	}{
		{"proxy connection failure", 0, http.StatusServiceUnavailable, "abb_unavailable"},
		{"rate limited", 429, http.StatusTooManyRequests, "abb_rate_limited"},
		{"blocked", 403, http.StatusBadGateway, "abb_blocked"},
		{"upstream outage", 503, http.StatusServiceUnavailable, "abb_unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := abb.NewClient("https://audiobookbay.lu", &http.Client{Transport: abbSourceTransport{status: test.status}})
			service := resolver.NewService(config.Config{}, nil, nil, client)
			server := NewServer(config.Config{}, service, nil, nil, nil, nil, nil, nil)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/sources", strings.NewReader(`{"type":"audiobook","title":"Dune"}`))
			rec := httptest.NewRecorder()
			server.handleSources(rec, req)
			if rec.Code != test.want {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, test.want, rec.Body.String())
			}
			var payload struct {
				Error string `json:"error"`
				Code  string `json:"code"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Code != test.code || !strings.Contains(payload.Error, "AudiobookBay") {
				t.Fatalf("unexpected response: %s", rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "private") {
				t.Fatal("upstream diagnostics must not leak into the response")
			}
		})
	}
}
