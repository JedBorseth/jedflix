package search

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

// CometSearcher queries a Comet Stremio addon (https://github.com/g0ldyy/comet)
// with no config segment, which makes Comet return raw P2P streams
// (infoHash + fileIdx). Real Debrid resolution happens in our own resolver,
// so the user's RD key never leaves this backend.
type CometSearcher struct {
	baseURL string
	client  *http.Client
}

func NewCometSearcher(cfg config.Config) *CometSearcher {
	client := cfg.HTTPClient()
	client.Timeout = 45 * time.Second
	return &CometSearcher{baseURL: cfg.CometURL, client: client}
}

type cometStream struct {
	Name          string `json:"name"`
	Description   string `json:"description"`
	InfoHash      string `json:"infoHash"`
	FileIdx       *int   `json:"fileIdx"`
	BehaviorHints struct {
		Filename  string `json:"filename"`
		VideoSize int64  `json:"videoSize"`
	} `json:"behaviorHints"`
}

func (c *CometSearcher) SearchMovie(ctx context.Context, imdbID string) ([]Release, error) {
	return c.fetchStreams(ctx, fmt.Sprintf("%s/stream/movie/%s.json", c.baseURL, normalizeIMDbID(imdbID)))
}

func (c *CometSearcher) SearchEpisode(ctx context.Context, imdbID string, season, episode int) ([]Release, error) {
	return c.fetchStreams(ctx, fmt.Sprintf("%s/stream/series/%s:%d:%d.json", c.baseURL, normalizeIMDbID(imdbID), season, episode))
}

func (c *CometSearcher) fetchStreams(ctx context.Context, endpoint string) ([]Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("comet request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("comet returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload struct {
		Streams []cometStream `json:"streams"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode comet response: %w", err)
	}

	releases := make([]Release, 0, len(payload.Streams))
	for _, stream := range payload.Streams {
		if release, ok := parseCometStream(stream); ok {
			releases = append(releases, release)
		}
	}
	return releases, nil
}

// parseCometStream maps one Comet stream to a Release. Comet renders the
// description as emoji-prefixed lines:
//
//	📄 Movie.2020.1080p.WEB-DL.x264-GRP.mp4
//	📹 x264 • 8bit | 🔊 AAC • 2.0
//	⭐ WEB-DL | 🏷️ GRP
//	👤 42 💾 4.2 GB 🔎 TorrentSite
//
// Seeders are only present for some scrapers (DMM/StremThru omit them).
// Info/notice streams Comet emits on errors carry no infoHash and are dropped.
func parseCometStream(stream cometStream) (Release, bool) {
	infoHash := strings.ToLower(strings.TrimSpace(stream.InfoHash))
	if !isHexInfoHash(infoHash) {
		return Release{}, false
	}

	var fileLine, statsLine string
	var details []string
	for _, line := range strings.Split(stream.Description, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "", !hasASCIIAlnum(line):
			// Blank lines and language-flag-only lines ("🇬🇧/🇫🇷").
		case strings.HasPrefix(line, "📄"):
			fileLine = strings.TrimSpace(strings.TrimPrefix(line, "📄"))
		case strings.Contains(line, "💾"), strings.Contains(line, "👤"), strings.Contains(line, "🔎"):
			statsLine = line
		default:
			details = append(details, cometDetailParts(line)...)
		}
	}

	title := strings.TrimSpace(stream.BehaviorHints.Filename)
	if title == "" {
		title = fileLine
	}
	if title == "" {
		title = infoHash
	}

	release := Release{
		Title:    title,
		Info:     strings.Join(details, " · "),
		Magnet:   "magnet:?xt=urn:btih:" + infoHash,
		InfoHash: infoHash,
		FileIdx:  stream.FileIdx,
		Source:   "comet",
	}
	if stream.BehaviorHints.VideoSize > 0 {
		release.SizeBytes, release.SizeKnown = stream.BehaviorHints.VideoSize, true
	} else {
		release.SizeBytes, release.SizeKnown = ParseSizeHintFromText(statsLine)
	}
	release.Seeders, release.SeedersKnown = ParseSeedersFromText(statsLine)
	// Comet's name ends with its parsed resolution ("[TORRENT🧲] Comet 2160p");
	// fall back to the filename when Comet reports "Unknown".
	release.Resolution = ParseResolutionFromText(stream.Name)
	if release.Resolution == 0 {
		release.Resolution = ParseResolutionFromText(title)
	}
	return release, true
}

// cometDetailParts turns "📹 x264 • 8bit | 🔊 AAC • 2.0" into ["x264", "8bit", "AAC", "2.0"].
func cometDetailParts(line string) []string {
	for _, marker := range []string{"📹", "🔊", "⭐", "🏷️", "🏷"} {
		line = strings.ReplaceAll(line, marker, "")
	}
	var parts []string
	for _, group := range strings.Split(line, "|") {
		for _, part := range strings.Split(group, "•") {
			if part = strings.Join(strings.Fields(part), " "); part != "" {
				parts = append(parts, part)
			}
		}
	}
	return parts
}

func hasASCIIAlnum(s string) bool {
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return true
		}
	}
	return false
}

func isHexInfoHash(hash string) bool {
	if len(hash) != 40 {
		return false
	}
	for _, r := range hash {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func normalizeIMDbID(imdbID string) string {
	return "tt" + strings.TrimPrefix(strings.TrimSpace(imdbID), "tt")
}
