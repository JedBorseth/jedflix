package lastfm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

const (
	defaultAPIBaseURL = "https://ws.audioscrobbler.com/2.0/"
	defaultCacheTTL   = 6 * time.Hour
	defaultLimit      = 20
	maxCacheEntries   = 800
	userAgent         = "JedFlix/1.0 (https://github.com/JedBorseth/jedflix)"
)

type Client struct {
	apiKey   string
	apiBase  string
	http     *http.Client
	cacheTTL time.Duration
	now      func() time.Time
	cacheMu  sync.Mutex
	cache    map[string]cacheEntry
}

type cacheEntry struct {
	payload  any
	cachedAt time.Time
}

func NewClient(cfg config.Config) *Client {
	httpClient := cfg.HTTPClient()
	httpClient.Timeout = 20 * time.Second

	apiBase := strings.TrimRight(cfg.LastFMAPIBaseURL, "/")
	if apiBase == "" {
		apiBase = strings.TrimRight(defaultAPIBaseURL, "/")
	}
	ttl := cfg.LastFMCacheTTL
	if ttl <= 0 {
		ttl = defaultCacheTTL
	}

	return &Client{
		apiKey:   strings.TrimSpace(cfg.LastFMAPIKey),
		apiBase:  apiBase,
		http:     httpClient,
		cacheTTL: ttl,
		now:      time.Now,
		cache:    make(map[string]cacheEntry),
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.apiKey != ""
}

func (c *Client) GetSimilarArtists(ctx context.Context, artist string, limit int) ([]SimilarArtist, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	artist = strings.TrimSpace(artist)
	if artist == "" {
		return nil, fmt.Errorf("%w: artist is required", ErrBadRequest)
	}
	limit = clampLimit(limit)

	cacheKey := fmt.Sprintf("similar-artists:%s:%d", strings.ToLower(artist), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if artists, ok := cached.([]SimilarArtist); ok {
			return artists, nil
		}
	}

	params := url.Values{}
	params.Set("method", "artist.getSimilar")
	params.Set("artist", artist)
	params.Set("limit", strconv.Itoa(limit))
	params.Set("autocorrect", "1")

	var payload similarArtistsResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	artists := make([]SimilarArtist, 0, len(payload.SimilarArtists.Artist))
	for _, item := range payload.SimilarArtists.Artist {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		artists = append(artists, SimilarArtist{
			Name:     name,
			MBID:     strings.TrimSpace(item.MBID),
			URL:      strings.TrimSpace(item.URL),
			Match:    parseMatch(item.Match),
			ImageURL: pickImage(item.Image),
		})
	}
	c.putCache(cacheKey, artists)
	return artists, nil
}

func (c *Client) GetSimilarTracks(ctx context.Context, artist, track string, limit int) ([]SimilarTrack, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	artist = strings.TrimSpace(artist)
	track = strings.TrimSpace(track)
	if artist == "" || track == "" {
		return nil, fmt.Errorf("%w: artist and track are required", ErrBadRequest)
	}
	limit = clampLimit(limit)

	cacheKey := fmt.Sprintf("similar-tracks:%s:%s:%d", strings.ToLower(artist), strings.ToLower(track), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if tracks, ok := cached.([]SimilarTrack); ok {
			return tracks, nil
		}
	}

	params := url.Values{}
	params.Set("method", "track.getSimilar")
	params.Set("artist", artist)
	params.Set("track", track)
	params.Set("limit", strconv.Itoa(limit))
	params.Set("autocorrect", "1")

	var payload similarTracksResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	tracks := make([]SimilarTrack, 0, len(payload.SimilarTracks.Track))
	for _, item := range payload.SimilarTracks.Track {
		name := strings.TrimSpace(item.Name)
		artistName := strings.TrimSpace(item.Artist.Name)
		if name == "" || artistName == "" {
			continue
		}
		tracks = append(tracks, SimilarTrack{
			Name:     name,
			Artist:   artistName,
			MBID:     strings.TrimSpace(item.MBID),
			URL:      strings.TrimSpace(item.URL),
			Match:    parseMatch(item.Match),
			ImageURL: pickImage(item.Image),
		})
	}
	c.putCache(cacheKey, tracks)
	return tracks, nil
}

func (c *Client) GetArtistTopTags(ctx context.Context, artist string) ([]Tag, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	artist = strings.TrimSpace(artist)
	if artist == "" {
		return nil, fmt.Errorf("%w: artist is required", ErrBadRequest)
	}

	cacheKey := fmt.Sprintf("artist-tags:%s", strings.ToLower(artist))
	if cached, ok := c.getCache(cacheKey); ok {
		if tags, ok := cached.([]Tag); ok {
			return tags, nil
		}
	}

	params := url.Values{}
	params.Set("method", "artist.getTopTags")
	params.Set("artist", artist)
	params.Set("autocorrect", "1")

	var payload topTagsResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	tags := make([]Tag, 0, len(payload.TopTags.Tag))
	for _, item := range payload.TopTags.Tag {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		tags = append(tags, Tag{
			Name:  name,
			Count: item.Count,
		})
	}
	c.putCache(cacheKey, tags)
	return tags, nil
}

func (c *Client) getJSON(ctx context.Context, params url.Values, dest any) error {
	params.Set("api_key", c.apiKey)
	params.Set("format", "json")

	reqURL := c.apiBase + "/?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return fmt.Errorf("%w: read body: %v", ErrFetchFailed, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%w: status %d", ErrFetchFailed, resp.StatusCode)
	}
	if err := json.Unmarshal(body, dest); err != nil {
		return fmt.Errorf("%w: decode: %v", ErrFetchFailed, err)
	}
	return nil
}

func (c *Client) getCache(key string) (any, bool) {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()
	entry, ok := c.cache[key]
	if !ok {
		return nil, false
	}
	if c.now().Sub(entry.cachedAt) > c.cacheTTL {
		delete(c.cache, key)
		return nil, false
	}
	return entry.payload, true
}

func (c *Client) putCache(key string, payload any) {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()
	if len(c.cache) >= maxCacheEntries {
		// Drop arbitrary stale/oldest-ish entries until under limit.
		cutoff := c.now().Add(-c.cacheTTL)
		for k, entry := range c.cache {
			if entry.cachedAt.Before(cutoff) {
				delete(c.cache, k)
			}
			if len(c.cache) < maxCacheEntries/2 {
				break
			}
		}
		if len(c.cache) >= maxCacheEntries {
			for k := range c.cache {
				delete(c.cache, k)
				if len(c.cache) < maxCacheEntries-50 {
					break
				}
			}
		}
	}
	c.cache[key] = cacheEntry{payload: payload, cachedAt: c.now()}
}

func clampLimit(limit int) int {
	if limit <= 0 {
		return defaultLimit
	}
	if limit > 50 {
		return 50
	}
	return limit
}

func parseMatch(raw string) float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0
	}
	return n
}

func pickImage(images []lfmImage) string {
	best := ""
	bestRank := -1
	for _, img := range images {
		url := strings.TrimSpace(img.URL)
		if url == "" {
			continue
		}
		rank := imageSizeRank(img.Size)
		if rank >= bestRank {
			bestRank = rank
			best = url
		}
	}
	return best
}

func imageSizeRank(size string) int {
	switch strings.ToLower(strings.TrimSpace(size)) {
	case "mega":
		return 5
	case "extralarge":
		return 4
	case "large":
		return 3
	case "medium":
		return 2
	case "small":
		return 1
	default:
		return 0
	}
}

func mapAPIError(code int, message string) error {
	msg := strings.TrimSpace(message)
	switch code {
	case 6:
		return fmt.Errorf("%w: %s", ErrBadRequest, msg)
	case 7:
		return fmt.Errorf("%w: %s", ErrNotFound, msg)
	default:
		if msg == "" {
			msg = fmt.Sprintf("last.fm error %d", code)
		}
		return fmt.Errorf("%w: %s", ErrFetchFailed, msg)
	}
}

// Last.fm JSON payloads — field names match their API.

type lfmImage struct {
	URL  string `json:"#text"`
	Size string `json:"size"`
}

type similarArtistsResponse struct {
	Error          int    `json:"error"`
	Message        string `json:"message"`
	SimilarArtists struct {
		Artist []struct {
			Name  string     `json:"name"`
			MBID  string     `json:"mbid"`
			Match string     `json:"match"`
			URL   string     `json:"url"`
			Image []lfmImage `json:"image"`
		} `json:"artist"`
	} `json:"similarartists"`
}

type similarTracksResponse struct {
	Error         int    `json:"error"`
	Message       string `json:"message"`
	SimilarTracks struct {
		Track []struct {
			Name   string `json:"name"`
			MBID   string `json:"mbid"`
			Match  string `json:"match"`
			URL    string `json:"url"`
			Artist struct {
				Name string `json:"name"`
				MBID string `json:"mbid"`
			} `json:"artist"`
			Image []lfmImage `json:"image"`
		} `json:"track"`
	} `json:"similartracks"`
}

type topTagsResponse struct {
	Error   int    `json:"error"`
	Message string `json:"message"`
	TopTags struct {
		Tag []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"tag"`
	} `json:"toptags"`
}
