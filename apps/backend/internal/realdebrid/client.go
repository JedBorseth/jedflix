package realdebrid

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

const apiBase = "https://api.real-debrid.com/rest/1.0"

type Client struct {
	token  string
	client *http.Client
}

func NewClient(cfg config.Config) *Client {
	// Resolve always uses the caller's BYO Real Debrid token via NewClientWithToken.
	return NewClientWithToken(cfg, "")
}

func NewClientWithToken(cfg config.Config, token string) *Client {
	client := cfg.HTTPClient()
	client.Timeout = 60 * time.Second
	return &Client{
		token:  strings.TrimSpace(token),
		client: client,
	}
}

type APIError struct {
	Path       string
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("real-debrid %s returned %d: %s", e.Path, e.StatusCode, e.Body)
}

type TorrentInfo struct {
	ID       string        `json:"id"`
	Status   string        `json:"status"`
	Hash     string        `json:"hash"`
	Progress float64       `json:"progress"`
	Files    []TorrentFile `json:"files"`
	Links    []string      `json:"links"`
	// Present while status is downloading or magnet_conversion.
	Seeders *int `json:"seeders,omitempty"`
}

type TorrentListItem struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	Hash     string `json:"hash"`
	Status   string `json:"status"`
}

type TorrentFile struct {
	ID       int    `json:"id"`
	Path     string `json:"path"`
	Bytes    int64  `json:"bytes"`
	Selected int    `json:"selected"`
}

type UnrestrictResponse struct {
	Download string `json:"download"`
	Filename string `json:"filename"`
	Filesize int64  `json:"filesize"`
}

func (c *Client) AddMagnet(ctx context.Context, magnet string) (string, error) {
	form := url.Values{}
	form.Set("magnet", magnet)
	var resp struct {
		ID string `json:"id"`
	}
	if err := c.postForm(ctx, "/torrents/addMagnet", form, &resp); err != nil {
		return "", err
	}
	return resp.ID, nil
}

func (c *Client) SelectFiles(ctx context.Context, torrentID string, fileIDs []int) error {
	form := url.Values{}
	if len(fileIDs) == 0 {
		form.Set("files", "all")
	} else {
		ids := make([]string, len(fileIDs))
		for i, id := range fileIDs {
			ids[i] = strconv.Itoa(id)
		}
		form.Set("files", strings.Join(ids, ","))
	}
	return c.postForm(ctx, "/torrents/selectFiles/"+torrentID, form, nil)
}

func (c *Client) GetTorrentInfo(ctx context.Context, torrentID string) (*TorrentInfo, error) {
	var info TorrentInfo
	if err := c.getJSON(ctx, "/torrents/info/"+torrentID, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

func (c *Client) ListTorrents(ctx context.Context) ([]TorrentListItem, error) {
	var torrents []TorrentListItem
	if err := c.getJSON(ctx, "/torrents", &torrents); err != nil {
		return nil, err
	}
	return torrents, nil
}

func (c *Client) DeleteTorrent(ctx context.Context, torrentID string) error {
	return c.delete(ctx, "/torrents/delete/"+torrentID)
}

// WaitForFileList polls until Real Debrid has finished magnet conversion and
// exposed the torrent file list (status waiting_files_selection / downloaded).
func (c *Client) WaitForFileList(ctx context.Context, torrentID string, timeout time.Duration) (*TorrentInfo, error) {
	deadline := time.Now().Add(timeout)
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("real-debrid torrent %s timed out waiting for file list", torrentID)
		}

		info, err := c.GetTorrentInfo(ctx, torrentID)
		if err != nil {
			return nil, err
		}
		switch info.Status {
		case "error", "magnet_error", "virus", "dead":
			return nil, fmt.Errorf("real-debrid torrent failed: %s", info.Status)
		case "waiting_files_selection", "downloaded":
			if len(info.Files) > 0 {
				return info, nil
			}
		default:
			// magnet_conversion / queued / downloading — files may already be present
			if len(info.Files) > 0 && info.Status != "magnet_conversion" {
				return info, nil
			}
		}
		time.Sleep(2 * time.Second)
	}
}

func (c *Client) WaitReady(
	ctx context.Context,
	torrentID string,
	timeout time.Duration,
	initial *TorrentInfo,
	onProgress func(string),
) (*TorrentInfo, error) {
	deadline := time.Now().Add(timeout)
	info := initial
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("real-debrid torrent %s timed out", torrentID)
		}

		if info == nil {
			var err error
			info, err = c.GetTorrentInfo(ctx, torrentID)
			if err != nil {
				return nil, err
			}
		}
		switch info.Status {
		case "downloaded":
			return info, nil
		case "error", "magnet_error", "virus", "dead":
			return nil, fmt.Errorf("real-debrid torrent failed: %s", info.Status)
		}
		if onProgress != nil {
			status := strings.ReplaceAll(info.Status, "_", " ")
			if info.Progress > 0 {
				onProgress(fmt.Sprintf("Downloading on Real Debrid… %.0f%% (%s)", info.Progress, status))
			} else {
				onProgress(fmt.Sprintf("Waiting for Real Debrid… (%s)", status))
			}
		}
		info = nil
		// Poll slower to stay under RD's 250 req/min limit across fallbacks.
		time.Sleep(4 * time.Second)
	}
}

func (c *Client) UnrestrictLink(ctx context.Context, link string) (*UnrestrictResponse, error) {
	form := url.Values{}
	form.Set("link", link)
	var resp UnrestrictResponse
	if err := c.postForm(ctx, "/unrestrict/link", form, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func PickLargestVideoFile(files []TorrentFile) (TorrentFile, bool) {
	return pickBestVideoFile(files, nil)
}

var (
	episodePattern = regexp.MustCompile(`(?i)[Ss](\d{1,2})[Ee](\d{1,2})`)
	nonTokenChars  = regexp.MustCompile(`[^a-z0-9]+`)
	titleStopWords = map[string]struct{}{
		"a": {}, "an": {}, "and": {}, "of": {}, "the": {}, "to": {}, "in": {},
		"on": {}, "for": {}, "with": {}, "part": {}, "pt": {},
	}
)

// PickMovieFile selects a video from a torrent for a movie.
// Preference order: explicit fileIdx → title match among videos → sole video file.
// Multi-file packs without a title match return false (avoids playing the wrong film).
func PickMovieFile(files []TorrentFile, mediaTitle string, fileIdx *int) (TorrentFile, bool) {
	if fileIdx != nil && *fileIdx >= 0 && *fileIdx < len(files) {
		candidate := files[*fileIdx]
		if isVideoFile(candidate.Path) {
			return candidate, true
		}
	}

	videos := make([]TorrentFile, 0, len(files))
	for _, file := range files {
		if isVideoFile(file.Path) {
			videos = append(videos, file)
		}
	}
	if len(videos) == 0 {
		return TorrentFile{}, false
	}
	if len(videos) == 1 {
		return videos[0], true
	}

	tokens := significantTitleTokens(mediaTitle)
	if len(tokens) == 0 {
		// No title to disambiguate a pack — refuse rather than guess by size.
		return TorrentFile{}, false
	}

	matched := make([]TorrentFile, 0)
	for _, file := range videos {
		if titleMatchesPath(file.Path, tokens) {
			matched = append(matched, file)
		}
	}
	return pickBestVideoFile(matched, nil)
}

func PickEpisodeFile(files []TorrentFile, season, episode int) (TorrentFile, bool) {
	matched := make([]TorrentFile, 0)
	for _, file := range files {
		if isVideoFile(file.Path) && matchesEpisode(file.Path, season, episode) {
			matched = append(matched, file)
		}
	}
	if file, ok := pickBestVideoFile(matched, nil); ok {
		return file, true
	}
	return PickLargestVideoFile(files)
}

func significantTitleTokens(title string) []string {
	normalized := nonTokenChars.ReplaceAllString(strings.ToLower(strings.TrimSpace(title)), " ")
	parts := strings.Fields(normalized)
	tokens := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		if len(part) < 2 {
			continue
		}
		if _, stop := titleStopWords[part]; stop {
			continue
		}
		if _, ok := seen[part]; ok {
			continue
		}
		seen[part] = struct{}{}
		tokens = append(tokens, part)
	}
	return tokens
}

func titleMatchesPath(path string, tokens []string) bool {
	if len(tokens) == 0 {
		return false
	}
	base := strings.ToLower(filepath.Base(path))
	haystack := nonTokenChars.ReplaceAllString(base, " ")
	matched := 0
	for _, token := range tokens {
		if strings.Contains(haystack, token) {
			matched++
		}
	}
	// Short titles (1–2 significant tokens) must match all; longer titles need majority.
	required := len(tokens)
	if required > 2 {
		required = (len(tokens) + 1) / 2
		if required < 2 {
			required = 2
		}
	}
	return matched >= required
}

func pickBestVideoFile(files []TorrentFile, predicate func(TorrentFile) bool) (TorrentFile, bool) {
	var bestCompatible TorrentFile
	var bestAny TorrentFile
	foundCompatible := false
	foundAny := false

	for _, file := range files {
		if predicate != nil && !predicate(file) {
			continue
		}
		if !isVideoFile(file.Path) {
			continue
		}
		if !foundAny || file.Bytes > bestAny.Bytes {
			bestAny = file
			foundAny = true
		}
		if isBrowserCompatibleVideoFile(file.Path) {
			if !foundCompatible || file.Bytes > bestCompatible.Bytes {
				bestCompatible = file
				foundCompatible = true
			}
		}
	}

	if foundCompatible {
		return bestCompatible, true
	}
	return bestAny, foundAny
}

func matchesEpisode(path string, season, episode int) bool {
	matches := episodePattern.FindStringSubmatch(filepath.Base(path))
	if len(matches) < 3 {
		return false
	}
	s, _ := strconv.Atoi(matches[1])
	e, _ := strconv.Atoi(matches[2])
	return s == season && e == episode
}

func isVideoFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts":
		return true
	default:
		return false
	}
}

func isBrowserCompatibleVideoFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".mp4" || ext == ".m4v"
}

func (c *Client) postForm(ctx context.Context, path string, form url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiBase+path, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	c.setHeaders(req)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return &APIError{Path: path, StatusCode: resp.StatusCode, Body: string(body)}
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+path, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return &APIError{Path: path, StatusCode: resp.StatusCode, Body: string(body)}
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) delete(ctx context.Context, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, apiBase+path, nil)
	if err != nil {
		return err
	}
	c.setHeaders(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return &APIError{Path: path, StatusCode: resp.StatusCode, Body: string(body)}
	}
	return nil
}

func IsInfringingError(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	body := strings.ToLower(apiErr.Body)
	return apiErr.StatusCode == http.StatusUnavailableForLegalReasons ||
		strings.Contains(body, "infringing_file") ||
		strings.Contains(body, `"error_code":35`) ||
		strings.Contains(body, `"error_code": 35`)
}

func IsRateLimitError(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	body := strings.ToLower(apiErr.Body)
	return apiErr.StatusCode == http.StatusTooManyRequests ||
		strings.Contains(body, "too_many_requests") ||
		strings.Contains(body, `"error_code":34`) ||
		strings.Contains(body, `"error_code": 34`)
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
}
