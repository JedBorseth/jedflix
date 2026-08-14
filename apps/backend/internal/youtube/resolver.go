package youtube

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/sync/singleflight"
)

var (
	ErrNotFound     = errors.New("no matching youtube audio found")
	ErrBadRequest   = errors.New("invalid youtube audio request")
	ErrResolveFail  = errors.New("youtube resolve failed")
	ErrYtdlpMissing = errors.New("yt-dlp is not installed")
)

const (
	defaultSearchCount = 8
	urlCacheTTL        = 45 * time.Minute
	maxURLCacheSize    = 256
)

// Resolver finds YouTube audio streams via yt-dlp without downloading files.
type Resolver struct {
	ytdlpPath   string
	cookiesFile string
	searchN     int
	now         func() time.Time

	mu       sync.Mutex
	cache    map[string]cachedURL
	inflight singleflight.Group
	// sem limits concurrent yt-dlp processes — not audio proxying.
	sem chan struct{}
}

type cachedURL struct {
	info     StreamInfo
	cachedAt time.Time
}

// Request identifies a track to resolve.
type Request struct {
	Artist     string
	Title      string
	Album      string
	DurationMs int // Spotify track length; used to prefer audio over music videos
	// VideoID skips ytsearch and extracts this YouTube video directly (catalog hits).
	VideoID string
}

// StreamInfo is a resolved direct audio URL (ephemeral; not stored on disk).
type StreamInfo struct {
	URL         string `json:"url"`
	ContentType string `json:"contentType"`
	Title       string `json:"title"`
	VideoID     string `json:"videoId"`
	Ext         string `json:"ext"`
	DurationMs  int    `json:"durationMs"`
}

type searchEntry struct {
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
}

type formatProbe struct {
	URL      string `json:"url"`
	Ext      string `json:"ext"`
	ACodec   string `json:"acodec"`
	Vcodec   string `json:"vcodec"`
	Protocol string `json:"protocol"`
}

func NewResolver() *Resolver {
	return NewResolverWithLimit(0)
}

// NewResolverWithLimit caps concurrent yt-dlp work. Cache hits and in-flight
// duplicates do not consume a slot. Audio proxying happens after release.
func NewResolverWithLimit(slots int) *Resolver {
	if slots <= 0 {
		slots = 3
	}
	cookies := strings.TrimSpace(os.Getenv("YTDLP_COOKIES_FILE"))
	if cookies == "" {
		cookies = strings.TrimSpace(os.Getenv("YOUTUBE_COOKIES_FILE"))
	}
	return &Resolver{
		ytdlpPath:   "yt-dlp",
		cookiesFile: cookies,
		searchN:     defaultSearchCount,
		now:         time.Now,
		cache:       make(map[string]cachedURL),
		sem:         make(chan struct{}, slots),
	}
}

func (r *Resolver) acquire(ctx context.Context) error {
	if r == nil || r.sem == nil {
		return ctx.Err()
	}
	select {
	case r.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (r *Resolver) release() {
	if r == nil || r.sem == nil {
		return
	}
	select {
	case <-r.sem:
	default:
	}
}

func (r *Resolver) Resolve(ctx context.Context, req Request) (*StreamInfo, error) {
	req.Artist = strings.TrimSpace(req.Artist)
	req.Title = strings.TrimSpace(req.Title)
	req.Album = strings.TrimSpace(req.Album)
	req.VideoID = strings.TrimSpace(req.VideoID)
	if req.VideoID != "" && !isLikelyVideoID(req.VideoID) {
		return nil, fmt.Errorf("%w: invalid videoId", ErrBadRequest)
	}
	if len(req.Artist) > 200 || len(req.Title) > 300 || len(req.Album) > 300 {
		return nil, fmt.Errorf("%w: input too long", ErrBadRequest)
	}
	if req.VideoID == "" {
		if req.Title == "" {
			return nil, fmt.Errorf("%w: title is required", ErrBadRequest)
		}
		if req.Artist == "" {
			return nil, fmt.Errorf("%w: artist is required", ErrBadRequest)
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	key := cacheKey(req)
	if info, ok := r.getCached(key); ok {
		cached := info
		return &cached, nil
	}

	v, err, _ := r.inflight.Do(key, func() (interface{}, error) {
		if info, ok := r.getCached(key); ok {
			return info, nil
		}
		// Detach from the caller so a cancelled HEAD does not kill an in-flight GET.
		resolveCtx, cancel := context.WithTimeout(context.Background(), ResolveTimeout)
		defer cancel()
		info, err := r.resolveUncached(resolveCtx, req)
		if err != nil {
			return nil, err
		}
		r.putCached(key, *info)
		return *info, nil
	})
	if err != nil {
		return nil, err
	}
	info := v.(StreamInfo)
	return &info, nil
}

// Invalidate drops a cached googlevideo URL so the next Resolve re-runs yt-dlp.
func (r *Resolver) Invalidate(req Request) {
	key := cacheKey(req)
	r.mu.Lock()
	delete(r.cache, key)
	r.mu.Unlock()
}

func (r *Resolver) resolveUncached(ctx context.Context, req Request) (*StreamInfo, error) {
	if _, err := exec.LookPath(r.ytdlpPath); err != nil {
		return nil, ErrYtdlpMissing
	}
	if err := r.acquire(ctx); err != nil {
		return nil, err
	}
	defer r.release()

	var best *searchEntry
	if req.VideoID != "" {
		best = &searchEntry{ID: req.VideoID}
	} else {
		entries, err := r.search(ctx, req)
		if err != nil {
			return nil, err
		}
		best = pickBestEntry(entries, req)
		if best == nil {
			return nil, ErrNotFound
		}
	}

	return r.extractStream(ctx, best)
}

func cacheKey(req Request) string {
	if req.VideoID != "" {
		return "vid\x00" + strings.ToLower(req.VideoID)
	}
	return strings.ToLower(req.Artist) + "\x00" +
		strings.ToLower(req.Title) + "\x00" +
		strings.ToLower(req.Album) + "\x00" +
		fmt.Sprintf("%d", req.DurationMs)
}

func (r *Resolver) getCached(key string) (StreamInfo, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.cache[key]
	if !ok {
		return StreamInfo{}, false
	}
	if r.now().Sub(entry.cachedAt) > urlCacheTTL {
		delete(r.cache, key)
		return StreamInfo{}, false
	}
	return entry.info, true
}

func (r *Resolver) putCached(key string, info StreamInfo) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.cache) >= maxURLCacheSize {
		for k, v := range r.cache {
			if r.now().Sub(v.cachedAt) > urlCacheTTL/2 {
				delete(r.cache, k)
			}
			if len(r.cache) < maxURLCacheSize {
				break
			}
		}
		for len(r.cache) >= maxURLCacheSize {
			for k := range r.cache {
				delete(r.cache, k)
				break
			}
		}
	}
	r.cache[key] = cachedURL{info: info, cachedAt: r.now()}
}

func buildSearchQuery(req Request) string {
	// Bias search toward official audio / Topic uploads instead of music videos
	// that often include intros/outros longer than the Spotify track.
	parts := []string{req.Artist, req.Title, "official audio"}
	return strings.Join(parts, " ")
}

func (r *Resolver) commonArgs() []string {
	args := []string{
		"--no-download",
		"--no-warnings",
	}
	if runtime := detectJSRuntime(); runtime != "" {
		args = append(args, "--js-runtimes", runtime)
	}
	if r.cookiesFile != "" {
		args = append(args, "--cookies", r.cookiesFile)
	}
	return args
}

func detectJSRuntime() string {
	// Prefer bun (already used by the monorepo / backend image).
	for _, name := range []string{"bun", "node", "deno"} {
		if _, err := exec.LookPath(name); err == nil {
			return name
		}
	}
	return ""
}

func (r *Resolver) search(ctx context.Context, req Request) ([]searchEntry, error) {
	n := r.searchN
	if n <= 0 {
		n = defaultSearchCount
	}
	query := fmt.Sprintf("ytsearch%d:%s", n, buildSearchQuery(req))
	args := append(r.commonArgs(),
		"--flat-playlist",
		"--dump-json",
		"--ignore-no-formats-error",
		query,
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
	entries := make([]searchEntry, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry searchEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		if entry.ID == "" && entry.WebpageURL == "" && entry.URL == "" {
			continue
		}
		entries = append(entries, entry)
	}
	if len(entries) == 0 {
		return nil, ErrNotFound
	}
	return entries, nil
}

func pickBestEntry(entries []searchEntry, req Request) *searchEntry {
	var best *searchEntry
	bestScore := -1e9
	for i := range entries {
		entry := &entries[i]
		if isLikelyLiveOrNonMusic(entry, req) {
			continue
		}
		score := scoreEntry(entry, req)
		if score > bestScore {
			bestScore = score
			best = entry
		}
	}
	if best != nil {
		return best
	}
	// Soft fallback: allow music videos / duration outliers if every candidate was filtered.
	bestScore = -1e9
	for i := range entries {
		entry := &entries[i]
		title := strings.ToLower(entry.Title)
		if entry.WasLive || strings.Contains(title, "official trailer") {
			continue
		}
		score := scoreEntry(entry, req)
		if score > bestScore {
			bestScore = score
			best = entry
		}
	}
	if best != nil {
		return best
	}
	if len(entries) > 0 {
		return &entries[0]
	}
	return nil
}

func isMusicVideoTitle(title string) bool {
	title = strings.ToLower(title)
	for _, bad := range []string{
		"official music video",
		"official video",
		"music video",
		"(official video)",
		"[official video]",
		"(mv)",
		"[mv]",
		" visualizer",
	} {
		if strings.Contains(title, bad) {
			return true
		}
	}
	return false
}

func isAudioPreferredTitle(title, channel string) bool {
	combined := strings.ToLower(title + " " + channel)
	for _, good := range []string{
		"official audio",
		"audio only",
		"lyric",
		" - topic",
		"topic",
	} {
		if strings.Contains(combined, good) {
			return true
		}
	}
	return strings.HasSuffix(strings.ToLower(strings.TrimSpace(channel)), "- topic")
}

func isLikelyLiveOrNonMusic(entry *searchEntry, req Request) bool {
	if entry.WasLive {
		return true
	}
	status := strings.ToLower(entry.LiveStatus)
	if status == "is_live" || status == "is_upcoming" {
		return true
	}
	title := strings.ToLower(entry.Title)
	for _, bad := range []string{"official trailer", "behind the scenes", "interview", "reaction", "live stream", "livestream"} {
		if strings.Contains(title, bad) {
			return true
		}
	}
	if entry.Duration > 0 && (entry.Duration < 45 || entry.Duration > 20*60) {
		return true
	}

	// When we know the Spotify length, drop obvious music videos that are much longer
	// (intros/outro skits) than the track.
	if req.DurationMs > 0 && entry.Duration > 0 {
		wantSec := float64(req.DurationMs) / 1000.0
		delta := entry.Duration - wantSec
		if isMusicVideoTitle(entry.Title) && delta > 25 {
			return true
		}
		if delta > maxFloat(45, wantSec*0.25) {
			return true
		}
	} else if isMusicVideoTitle(entry.Title) {
		// Without a duration target, still prefer skipping clear MVs in the first pass
		// by filtering them; soft fallback above can still pick them if needed.
		return true
	}
	return false
}

func scoreEntry(entry *searchEntry, req Request) float64 {
	title := normalizeText(entry.Title)
	channel := normalizeText(entry.Uploader)
	if channel == "" {
		channel = normalizeText(entry.Channel)
	}
	wantTitle := normalizeText(req.Title)
	wantArtist := normalizeText(req.Artist)
	wantAlbum := normalizeText(req.Album)

	score := 0.0
	if wantTitle != "" && strings.Contains(title, wantTitle) {
		score += 40
	} else {
		score += tokenOverlap(title, wantTitle) * 30
	}
	if wantArtist != "" {
		if strings.Contains(title, wantArtist) || strings.Contains(channel, wantArtist) {
			score += 30
		} else {
			score += tokenOverlap(title+" "+channel, wantArtist) * 20
		}
	}
	if wantAlbum != "" && strings.Contains(title, wantAlbum) {
		score += 10
	}

	rawTitle := entry.Title
	rawChannel := entry.Uploader
	if rawChannel == "" {
		rawChannel = entry.Channel
	}
	if isAudioPreferredTitle(rawTitle, rawChannel) {
		score += 35
	}
	if isMusicVideoTitle(rawTitle) {
		score -= 40
	}

	if req.DurationMs > 0 && entry.Duration > 0 {
		wantSec := float64(req.DurationMs) / 1000.0
		delta := absFloat(entry.Duration - wantSec)
		switch {
		case delta <= 5:
			score += 60
		case delta <= 12:
			score += 40
		case delta <= 20:
			score += 20
		case delta <= 35:
			score += 5
		default:
			score -= minFloat(50, delta)
		}
	} else if entry.Duration >= 90 && entry.Duration <= 8*60 {
		score += 8
	}

	if entry.ViewCount > 0 {
		score += minFloat(8, entry.ViewCount/1_000_000)
	}
	return score
}

func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func (r *Resolver) extractStream(ctx context.Context, entry *searchEntry) (*StreamInfo, error) {
	target := entry.WebpageURL
	if target == "" {
		target = entry.URL
	}
	if target == "" && entry.ID != "" {
		target = "https://www.youtube.com/watch?v=" + entry.ID
	}
	if target == "" {
		return nil, ErrNotFound
	}

	// Prefer AAC/MP4/MP3 for HTML5 audio (Safari/iOS reject webm/opus).
	// Avoid bare "bestaudio/best" — that often returns Opus and breaks the player.
	// --ignore-no-formats-error keeps JSON so we can still pick m4a/mp3 from Formats
	// when YouTube's advertised format set doesn't match the selector.
	format := "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio[acodec*=mp4a]/bestaudio[ext=mp4]/bestaudio[ext=mp3]/bestaudio[acodec*=mp3]/bestaudio[acodec*=aac]"
	args := append(r.commonArgs(),
		"--no-playlist",
		"--ignore-no-formats-error",
		"-f", format,
		"-J",
		target,
	)
	cmd := exec.CommandContext(ctx, r.ytdlpPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	if runErr != nil || !json.Valid(stdout.Bytes()) {
		// Selector missed (YouTube often only advertises webm first). Dump every
		// format so we can still pick m4a/mp3/aac from the list.
		fallbackArgs := append(r.commonArgs(),
			"--no-playlist",
			"--ignore-no-formats-error",
			"-J",
			target,
		)
		fallback := exec.CommandContext(ctx, r.ytdlpPath, fallbackArgs...)
		stdout.Reset()
		stderr.Reset()
		fallback.Stdout = &stdout
		fallback.Stderr = &stderr
		if err := fallback.Run(); err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				if runErr != nil {
					msg = runErr.Error()
				} else {
					msg = err.Error()
				}
			}
			return nil, fmt.Errorf("%w: extract: %s", ErrResolveFail, msg)
		}
	}

	var payload struct {
		ID               string        `json:"id"`
		Title            string        `json:"title"`
		URL              string        `json:"url"`
		Ext              string        `json:"ext"`
		ACodec           string        `json:"acodec"`
		Duration         float64       `json:"duration"`
		RequestedFormats []formatProbe `json:"requested_formats"`
		Formats          []formatProbe `json:"formats"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		return nil, fmt.Errorf("%w: decode extract: %v", ErrResolveFail, err)
	}

	streamURL := payload.URL
	ext := payload.Ext
	acodec := payload.ACodec
	if streamURL != "" && !isBrowserSafeAudio(ext, acodec) {
		streamURL = ""
	}
	if streamURL == "" {
		for _, f := range payload.RequestedFormats {
			if f.URL == "" || (f.Vcodec != "" && f.Vcodec != "none") {
				continue
			}
			if !isBrowserSafeAudio(f.Ext, f.ACodec) {
				continue
			}
			streamURL = f.URL
			ext = f.Ext
			acodec = f.ACodec
			break
		}
	}
	if streamURL == "" {
		for _, f := range payload.Formats {
			if f.URL == "" {
				continue
			}
			if f.Vcodec != "" && f.Vcodec != "none" {
				continue
			}
			if strings.Contains(f.Protocol, "m3u8") {
				continue
			}
			if !isBrowserSafeAudio(f.Ext, f.ACodec) {
				continue
			}
			streamURL = f.URL
			ext = f.Ext
			acodec = f.ACodec
			if f.Ext == "m4a" || strings.Contains(f.ACodec, "mp4a") {
				break
			}
		}
	}
	if streamURL == "" {
		return nil, fmt.Errorf("%w: no browser-compatible audio format (need m4a/mp3/aac)", ErrNotFound)
	}

	videoID := payload.ID
	if videoID == "" {
		videoID = entry.ID
	}
	title := payload.Title
	if title == "" {
		title = entry.Title
	}

	durationMs := firstPositiveDurationMs(
		DurationMsFromSeconds(payload.Duration),
		DurationMsFromSeconds(entry.Duration),
		DurationMsFromStreamURL(streamURL),
	)

	return &StreamInfo{
		URL:         streamURL,
		ContentType: contentTypeFor(ext, acodec),
		Title:       title,
		VideoID:     videoID,
		Ext:         ext,
		DurationMs:  durationMs,
	}, nil
}

func contentTypeFor(ext, acodec string) string {
	ext = strings.ToLower(ext)
	acodec = strings.ToLower(acodec)
	switch {
	case ext == "m4a" || ext == "mp4" || strings.Contains(acodec, "mp4a") || strings.Contains(acodec, "aac"):
		return "audio/mp4"
	case ext == "webm" || strings.Contains(acodec, "opus") || strings.Contains(acodec, "vorbis"):
		return "audio/webm"
	case ext == "mp3" || strings.Contains(acodec, "mp3"):
		return "audio/mpeg"
	case ext == "ogg":
		return "audio/ogg"
	default:
		return "application/octet-stream"
	}
}

// isBrowserSafeAudio reports formats HTML5 <audio> can play on Safari/iOS/Chrome.
func isBrowserSafeAudio(ext, acodec string) bool {
	ext = strings.ToLower(strings.TrimSpace(ext))
	acodec = strings.ToLower(strings.TrimSpace(acodec))
	if ext == "webm" || ext == "ogg" || strings.Contains(acodec, "opus") || strings.Contains(acodec, "vorbis") {
		return false
	}
	if ext == "m4a" || ext == "mp4" || ext == "mp3" {
		return true
	}
	return strings.Contains(acodec, "mp4a") ||
		strings.Contains(acodec, "aac") ||
		strings.Contains(acodec, "mp3")
}

func normalizeText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	b.Grow(len(value))
	prevSpace := false
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevSpace = false
			continue
		}
		if !prevSpace {
			b.WriteByte(' ')
			prevSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}

func tokenOverlap(haystack, needle string) float64 {
	needleTokens := strings.Fields(needle)
	if len(needleTokens) == 0 {
		return 0
	}
	hits := 0
	for _, token := range needleTokens {
		if len(token) < 2 {
			continue
		}
		if strings.Contains(haystack, token) {
			hits++
		}
	}
	return float64(hits) / float64(len(needleTokens))
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
