package tmdb

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

const (
	defaultAPIBaseURL = "https://api.themoviedb.org/3"
	maxResponseBytes  = 4 << 20 // 4 MiB
)

var safePathPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$`)

type Client struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

func NewClient(cfg config.Config) *Client {
	base := strings.TrimRight(cfg.TMDBAPIBaseURL, "/")
	if base == "" {
		base = defaultAPIBaseURL
	}
	client := cfg.HTTPClient()
	client.Timeout = 20 * time.Second
	return &Client{
		apiKey:  strings.TrimSpace(cfg.TMDBAPIKey),
		baseURL: base,
		http:    client,
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.apiKey != ""
}

// ProxyResult is a forwarded TMDB API response (status + raw body).
type ProxyResult struct {
	StatusCode  int
	ContentType string
	Body        []byte
}

// SanitizePath rejects path traversal and unexpected characters before proxying.
func SanitizePath(raw string) (string, error) {
	path := strings.Trim(raw, "/")
	if path == "" {
		return "", errors.New("missing tmdb path")
	}
	if strings.Contains(path, "..") || !safePathPattern.MatchString(path) {
		return "", errors.New("invalid tmdb path")
	}
	return path, nil
}

// ProxyGET forwards a GET to api.themoviedb.org/3/{path} with the server API key.
func (c *Client) ProxyGET(ctx context.Context, path string, query url.Values) (*ProxyResult, error) {
	if !c.Configured() {
		return nil, errors.New("tmdb is not configured")
	}
	clean, err := SanitizePath(path)
	if err != nil {
		return nil, err
	}

	upstream, err := url.Parse(c.baseURL + "/" + clean)
	if err != nil {
		return nil, fmt.Errorf("invalid tmdb url: %w", err)
	}
	q := url.Values{}
	for key, values := range query {
		if strings.EqualFold(key, "api_key") || strings.EqualFold(key, "api_key_v3") {
			continue
		}
		for _, value := range values {
			q.Add(key, value)
		}
	}
	q.Set("api_key", c.apiKey)
	upstream.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	limited := io.LimitReader(res.Body, maxResponseBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(body) > maxResponseBytes {
		return nil, errors.New("tmdb response too large")
	}

	ct := res.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json"
	}
	return &ProxyResult{
		StatusCode:  res.StatusCode,
		ContentType: ct,
		Body:        body,
	}, nil
}
