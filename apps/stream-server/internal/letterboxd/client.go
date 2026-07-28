package letterboxd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
)

const defaultUserAgent = "Mozilla/5.0 (compatible; JedFlix/1.0; +https://github.com/JedBorseth/jedflix)"

type Client struct {
	baseURL string
	http    *http.Client
	cache   *Cache
	now     func() time.Time
}

func NewClient(cfg config.Config) *Client {
	httpClient := cfg.HTTPClient()
	httpClient.Timeout = 30 * time.Second
	ttl := cfg.LetterboxdCacheTTL
	if ttl <= 0 {
		ttl = time.Hour
	}
	baseURL := strings.TrimRight(cfg.LetterboxdBaseURL, "/")
	if baseURL == "" {
		baseURL = "https://letterboxd.com"
	}
	return &Client{
		baseURL: baseURL,
		http:    httpClient,
		cache:   NewCache(ttl),
		now:     time.Now,
	}
}

func (c *Client) FilmsByDate(ctx context.Context, username string) (*FilmsResponse, error) {
	entry, err := c.load(ctx, username, false)
	if err != nil {
		return nil, err
	}
	return &FilmsResponse{
		User:        entry.Username,
		DisplayName: entry.DisplayName,
		Films:       entry.Films,
		CachedAt:    entry.CachedAt,
		Source:      "rss",
	}, nil
}

func (c *Client) Verify(ctx context.Context, username string) (*VerifyResponse, error) {
	normalized, err := NormalizeUsername(username)
	if err != nil {
		return &VerifyResponse{
			Valid:    false,
			Username: strings.TrimSpace(strings.ToLower(username)),
			Error:    "Enter a valid Letterboxd username (letters, numbers, underscores, hyphens).",
		}, nil
	}

	entry, err := c.load(ctx, normalized, false)
	if err != nil {
		switch {
		case err == ErrNotFound:
			return &VerifyResponse{
				Valid:    false,
				Username: normalized,
				Error:    "Letterboxd profile not found. Check the username and that the profile is public.",
			}, nil
		case err == ErrNoFilms:
			return &VerifyResponse{
				Valid:    false,
				Username: normalized,
				Error:    "This Letterboxd profile has no diary films yet. Log some watches on Letterboxd first.",
			}, nil
		default:
			return nil, err
		}
	}

	preview := entry.Films
	if len(preview) > 5 {
		preview = preview[:5]
	}

	return &VerifyResponse{
		Valid:       true,
		Username:    entry.Username,
		DisplayName: entry.DisplayName,
		FilmCount:   len(entry.Films),
		Films:       preview,
		CachedAt:    entry.CachedAt,
	}, nil
}

func (c *Client) load(ctx context.Context, username string, bypassCache bool) (cacheEntry, error) {
	normalized, err := NormalizeUsername(username)
	if err != nil {
		return cacheEntry{}, err
	}

	if !bypassCache {
		if cached, ok := c.cache.Get(normalized); ok {
			if len(cached.Films) == 0 {
				return cacheEntry{}, ErrNoFilms
			}
			return cached, nil
		}
	}

	displayName, films, err := c.fetchDiary(ctx, normalized)
	if err != nil {
		return cacheEntry{}, err
	}

	entry := cacheEntry{
		Username:    normalized,
		DisplayName: displayName,
		Films:       films,
		CachedAt:    c.now().UnixMilli(),
	}
	c.cache.Set(entry)

	if len(films) == 0 {
		return entry, ErrNoFilms
	}
	return entry, nil
}

func (c *Client) fetchDiary(ctx context.Context, username string) (string, []FilmEntry, error) {
	url := fmt.Sprintf("%s/%s/rss/", c.baseURL, username)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Accept", "application/rss+xml, application/xml, text/xml, */*")

	res, err := c.http.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return "", nil, fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}

	switch res.StatusCode {
	case http.StatusOK:
		displayName, films, parseErr := ParseDiaryRSS(strings.NewReader(string(body)))
		if parseErr != nil {
			return "", nil, fmt.Errorf("%w: %v", ErrFetchFailed, parseErr)
		}
		if displayName == "" {
			displayName = username
		}
		return displayName, films, nil
	case http.StatusNotFound:
		return "", nil, ErrNotFound
	default:
		if strings.Contains(string(body), "Just a moment") || strings.Contains(string(body), "Cloudflare") {
			return "", nil, fmt.Errorf("%w: blocked by Letterboxd protection", ErrFetchFailed)
		}
		return "", nil, fmt.Errorf("%w: unexpected status %d", ErrFetchFailed, res.StatusCode)
	}
}
