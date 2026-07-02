package realdebrid

import (
	"context"
	"encoding/json"
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
	client := cfg.HTTPClient()
	client.Timeout = 60 * time.Second
	return &Client{
		token:  cfg.RealDebridToken,
		client: client,
	}
}

type TorrentInfo struct {
	ID     string       `json:"id"`
	Status string       `json:"status"`
	Files  []TorrentFile `json:"files"`
	Links  []string     `json:"links"`
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

func (c *Client) WaitReady(ctx context.Context, torrentID string, timeout time.Duration) (*TorrentInfo, error) {
	deadline := time.Now().Add(timeout)
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("real-debrid torrent %s timed out", torrentID)
		}

		info, err := c.GetTorrentInfo(ctx, torrentID)
		if err != nil {
			return nil, err
		}
		switch info.Status {
		case "downloaded":
			return info, nil
		case "error", "magnet_error", "virus", "dead":
			return nil, fmt.Errorf("real-debrid torrent failed: %s", info.Status)
		}
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
		return fmt.Errorf("real-debrid %s returned %d: %s", path, resp.StatusCode, string(body))
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
		return fmt.Errorf("real-debrid %s returned %d: %s", path, resp.StatusCode, string(body))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
}
