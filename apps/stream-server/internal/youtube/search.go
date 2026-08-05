package youtube

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"unicode"
)

const defaultCatalogSearchCount = 12

// SearchTrack is a YouTube catalog hit shaped for music search UI / playback.
type SearchTrack struct {
	ID         string   `json:"id"`
	VideoID    string   `json:"videoId"`
	Name       string   `json:"name"`
	Artists    []string `json:"artists"`
	AlbumName  string   `json:"albumName"`
	ImageURL   string   `json:"imageUrl"`
	DurationMs int      `json:"durationMs"`
	Source     string   `json:"source"`
}

// SearchResponse is the JSON body for GET /youtube/search.
type SearchResponse struct {
	Tracks []SearchTrack `json:"tracks"`
}

type catalogSearchEntry struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Uploader   string  `json:"uploader"`
	Channel    string  `json:"channel"`
	Duration   float64 `json:"duration"`
	ViewCount  float64 `json:"view_count"`
	WebpageURL string  `json:"webpage_url"`
	URL        string  `json:"url"`
	LiveStatus string  `json:"live_status"`
	WasLive    bool    `json:"was_live"`
	Thumbnail  string  `json:"thumbnail"`
	Thumbnails []struct {
		URL    string `json:"url"`
		Height int    `json:"height"`
		Width  int    `json:"width"`
	} `json:"thumbnails"`
}

var (
	titleNoisePattern = regexp.MustCompile(`(?i)[\(\[\{][^)\]\}]*\b(official\s+(audio|video|music\s+video)|audio\s+only|lyric[s]?|visualizer|mv|hd|4k|remaster(ed)?|music\s+video)\b[^)\]\}]*[\)\]\}]`)
	dashSeparators    = []string{" - ", " – ", " — ", " − ", ": "}
)

// Search finds YouTube music videos for a free-text catalog query (not artist+title resolve).
func (r *Resolver) Search(ctx context.Context, query string) (*SearchResponse, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: empty query", ErrBadRequest)
	}
	if _, err := exec.LookPath(r.ytdlpPath); err != nil {
		return nil, ErrYtdlpMissing
	}

	n := r.searchN
	if n <= 0 {
		n = defaultCatalogSearchCount
	}
	// Bias toward songs / official audio without locking to a single artist.
	searchQuery := fmt.Sprintf("ytsearch%d:%s", n, query+" audio")
	args := append(r.commonArgs(),
		"--flat-playlist",
		"--dump-json",
		"--ignore-no-formats-error",
		searchQuery,
	)
	cmd := exec.CommandContext(ctx, r.ytdlpPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("%w: search: %s", ErrResolveFail, msg)
	}

	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	tracks := make([]SearchTrack, 0, len(lines))
	seen := make(map[string]struct{})
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry catalogSearchEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		track, ok := mapCatalogEntry(entry)
		if !ok {
			continue
		}
		key := dedupeKey(track.Artists, track.Name)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		tracks = append(tracks, track)
	}

	return &SearchResponse{Tracks: tracks}, nil
}

func mapCatalogEntry(entry catalogSearchEntry) (SearchTrack, bool) {
	if entry.ID == "" && entry.WebpageURL == "" && entry.URL == "" {
		return SearchTrack{}, false
	}
	videoID := entry.ID
	if videoID == "" {
		videoID = extractVideoID(entry.WebpageURL)
	}
	if videoID == "" {
		videoID = extractVideoID(entry.URL)
	}
	if videoID == "" {
		return SearchTrack{}, false
	}

	asSearch := searchEntry{
		ID:         videoID,
		Title:      entry.Title,
		Uploader:   entry.Uploader,
		Channel:    entry.Channel,
		Duration:   entry.Duration,
		ViewCount:  entry.ViewCount,
		WebpageURL: entry.WebpageURL,
		URL:        entry.URL,
		LiveStatus: entry.LiveStatus,
		WasLive:    entry.WasLive,
	}
	if isLikelyLiveOrNonMusic(&asSearch, Request{}) {
		return SearchTrack{}, false
	}

	channel := entry.Uploader
	if channel == "" {
		channel = entry.Channel
	}
	artist, name := parseCatalogTitle(entry.Title, channel)
	if name == "" {
		return SearchTrack{}, false
	}

	durationMs := 0
	if entry.Duration > 0 {
		durationMs = int(entry.Duration * 1000)
	}

	return SearchTrack{
		ID:         "yt:" + videoID,
		VideoID:    videoID,
		Name:       name,
		Artists:    []string{artist},
		AlbumName:  "YouTube",
		ImageURL:   pickThumbnail(entry),
		DurationMs: durationMs,
		Source:     "youtube",
	}, true
}

func parseCatalogTitle(title, channel string) (artist, trackName string) {
	cleaned := cleanCatalogTitle(title)
	if cleaned == "" {
		return "", ""
	}

	for _, sep := range dashSeparators {
		parts := strings.SplitN(cleaned, sep, 2)
		if len(parts) != 2 {
			continue
		}
		left := strings.TrimSpace(parts[0])
		right := strings.TrimSpace(parts[1])
		if left == "" || right == "" {
			continue
		}
		// Prefer shorter left side as artist for "Artist - Song" titles.
		if len(left) <= len(right)+8 {
			return left, right
		}
		return left, right
	}

	topicArtist := topicChannelArtist(channel)
	if topicArtist != "" {
		return topicArtist, cleaned
	}
	if channel = strings.TrimSpace(channel); channel != "" {
		return channel, cleaned
	}
	return "Unknown artist", cleaned
}

func topicChannelArtist(channel string) string {
	trimmed := strings.TrimSpace(channel)
	lower := strings.ToLower(trimmed)
	for _, suffix := range []string{" - topic", " – topic"} {
		if strings.HasSuffix(lower, suffix) {
			return strings.TrimSpace(trimmed[:len(trimmed)-len(suffix)])
		}
	}
	return ""
}

func cleanCatalogTitle(title string) string {
	cleaned := titleNoisePattern.ReplaceAllString(title, "")
	cleaned = strings.TrimSpace(cleaned)
	cleaned = strings.Trim(cleaned, "-–—:| ")
	return strings.Join(strings.Fields(cleaned), " ")
}

func pickThumbnail(entry catalogSearchEntry) string {
	if entry.Thumbnail != "" {
		return entry.Thumbnail
	}
	bestURL := ""
	bestArea := -1
	for _, thumb := range entry.Thumbnails {
		if thumb.URL == "" {
			continue
		}
		area := thumb.Height * thumb.Width
		if area > bestArea {
			bestArea = area
			bestURL = thumb.URL
		}
	}
	if bestURL != "" {
		return bestURL
	}
	if entry.ID != "" {
		return "https://i.ytimg.com/vi/" + entry.ID + "/hqdefault.jpg"
	}
	return ""
}

func extractVideoID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") && !strings.ContainsAny(raw, "/?&=") {
		// Already an id-like token.
		if isLikelyVideoID(raw) {
			return raw
		}
		return ""
	}
	for _, key := range []string{"v=", "youtu.be/", "/shorts/", "/embed/"} {
		idx := strings.Index(raw, key)
		if idx < 0 {
			continue
		}
		rest := raw[idx+len(key):]
		end := strings.IndexAny(rest, "?&/#")
		if end >= 0 {
			rest = rest[:end]
		}
		if isLikelyVideoID(rest) {
			return rest
		}
	}
	return ""
}

func isLikelyVideoID(value string) bool {
	if len(value) < 6 || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func dedupeKey(artists []string, name string) string {
	artist := normalizeText(strings.Join(artists, " "))
	title := normalizeText(name)
	return artist + "\x00" + title
}
