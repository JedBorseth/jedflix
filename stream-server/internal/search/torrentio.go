package search

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
)

type TorrentioSearcher struct {
	baseURL string
	client  *http.Client
}

func NewTorrentioSearcher(cfg config.Config) *TorrentioSearcher {
	client := cfg.HTTPClient()
	client.Timeout = 45 * time.Second
	return &TorrentioSearcher{
		baseURL: cfg.TorrentioURL,
		client:  client,
	}
}

type torrentioResponse struct {
	Streams []torrentioStream `json:"streams"`
}

type torrentioStream struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	URL         string `json:"url"`
	InfoHash    string `json:"infoHash"`
	Description string `json:"description"`
}

func (t *TorrentioSearcher) SearchMovie(ctx context.Context, imdbID string) ([]Release, error) {
	imdbID = normalizeIMDbID(imdbID)
	endpoint := fmt.Sprintf("%s/stream/movie/%s.json", t.baseURL, imdbID)
	return t.fetchStreams(ctx, endpoint)
}

func (t *TorrentioSearcher) SearchEpisode(ctx context.Context, imdbID string, season, episode int) ([]Release, error) {
	imdbID = normalizeIMDbID(imdbID)
	endpoint := fmt.Sprintf("%s/stream/series/%s:%d:%d.json", t.baseURL, imdbID, season, episode)
	return t.fetchStreams(ctx, endpoint)
}

func (t *TorrentioSearcher) fetchStreams(ctx context.Context, endpoint string) ([]Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Accept", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("torrentio returned %d: %s", resp.StatusCode, string(body))
	}

	var payload torrentioResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	releases := make([]Release, 0, len(payload.Streams))
	for _, stream := range payload.Streams {
		release := normalizeTorrentioStream(stream)
		if release.Magnet != "" || release.InfoHash != "" {
			releases = append(releases, release)
		}
	}
	return releases, nil
}

func normalizeTorrentioStream(stream torrentioStream) Release {
	label := strings.TrimSpace(stream.Title)
	if label == "" {
		label = strings.TrimSpace(stream.Name)
	}
	description := strings.TrimSpace(stream.Description)
	combined := strings.Join([]string{label, description}, " ")

	sizeBytes, sizeKnown := ParseSizeHintFromText(combined)
	seeders, seedersKnown := ParseSeedersFromText(combined)
	resolution := ParseResolutionFromText(combined)

	magnet := stream.URL
	infoHash := strings.ToLower(strings.TrimSpace(stream.InfoHash))
	if magnet == "" && infoHash != "" {
		magnet = "magnet:?xt=urn:btih:" + infoHash
	}
	if infoHash == "" && strings.HasPrefix(magnet, "magnet:") {
		if parsed, err := url.Parse(magnet); err == nil {
			for _, xt := range parsed.Query()["xt"] {
				if strings.HasPrefix(xt, "urn:btih:") {
					infoHash = strings.ToLower(strings.TrimPrefix(xt, "urn:btih:"))
					break
				}
			}
		}
	}

	return Release{
		Title:        label,
		Magnet:       magnet,
		InfoHash:     infoHash,
		SizeBytes:    sizeBytes,
		SizeKnown:    sizeKnown,
		Seeders:      seeders,
		SeedersKnown: seedersKnown,
		Resolution:   resolution,
		Source:       "torrentio",
	}
}

func normalizeIMDbID(imdbID string) string {
	imdbID = strings.TrimSpace(imdbID)
	imdbID = strings.TrimPrefix(imdbID, "tt")
	return "tt" + imdbID
}
