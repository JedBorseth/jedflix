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

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
)

const apiBase = "https://api.real-debrid.com/rest/1.0"

type Client struct {
	token  string
	client *http.Client
}

func NewClient(cfg config.Config) *Client {
	return NewClientWithToken(cfg, cfg.RealDebridToken)
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
	ID     string        `json:"id"`
	Status string        `json:"status"`
	Hash   string        `json:"hash"`
	Files  []TorrentFile `json:"files"`
	Links  []string      `json:"links"`
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

func (c *Client) FindByInfoHash(ctx context.Context, infoHash string) (*TorrentListItem, error) {
	infoHash = strings.ToLower(strings.TrimSpace(infoHash))
	if infoHash == "" {
		return nil, nil
	}
	torrents, err := c.ListTorrents(ctx)
	if err != nil {
		return nil, err
	}
	for _, torrent := range torrents {
		if strings.ToLower(strings.TrimSpace(torrent.Hash)) == infoHash {
			return &torrent, nil
		}
	}
	return nil, nil
}

func (c *Client) DeleteTorrent(ctx context.Context, torrentID string) error {
	return c.delete(ctx, "/torrents/delete/"+torrentID)
}

func (c *Client) WaitReady(ctx context.Context, torrentID string, timeout time.Duration, initial *TorrentInfo) (*TorrentInfo, error) {
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
		info = nil
		time.Sleep(2 * time.Second)
	}
}

func (c *Client) InstantAvailability(ctx context.Context, infoHashes []string) (map[string]bool, error) {
	result := make(map[string]bool, len(infoHashes))
	if len(infoHashes) == 0 {
		return result, nil
	}

	form := url.Values{}
	for _, hash := range infoHashes {
		form.Add("hash", strings.ToLower(hash))
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+"/torrents/instantAvailability?"+form.Encode(), nil)
	if err != nil {
		return nil, err
	}
	c.setHeaders(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return result, fmt.Errorf("instantAvailability returned %d: %s", resp.StatusCode, string(body))
	}

	var payload map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	for hash := range payload {
		result[strings.ToLower(hash)] = true
	}
	return result, nil
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
	var best TorrentFile
	found := false
	for _, file := range files {
		if !isVideoFile(file.Path) {
			continue
		}
		if !found || file.Bytes > best.Bytes {
			best = file
			found = true
		}
	}
	return best, found
}

var episodePattern = regexp.MustCompile(`(?i)[Ss](\d{1,2})[Ee](\d{1,2})`)

func PickEpisodeFile(files []TorrentFile, season, episode int) (TorrentFile, bool) {
	var best TorrentFile
	found := false
	for _, file := range files {
		if !isVideoFile(file.Path) {
			continue
		}
		if matchesEpisode(file.Path, season, episode) {
			if !found || file.Bytes > best.Bytes {
				best = file
				found = true
			}
		}
	}
	if found {
		return best, true
	}
	return PickLargestVideoFile(files)
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

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
}
