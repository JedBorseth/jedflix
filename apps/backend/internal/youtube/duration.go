package youtube

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	// HeaderDurationMs is the resolved yt-dlp track length (not HTML5 audio.duration).
	HeaderDurationMs = "X-Audio-Duration-Ms"
	// HeaderExt is the selected audio container (m4a, mp3, …).
	HeaderExt = "X-Audio-Ext"
)

// DurationMsFromSeconds converts yt-dlp's float duration into milliseconds.
func DurationMsFromSeconds(seconds float64) int {
	if seconds <= 0 || seconds > 24*60*60 {
		return 0
	}
	return int(seconds * 1000)
}

// DurationMsFromStreamURL reads YouTube's `dur=` query param when present.
func DurationMsFromStreamURL(raw string) int {
	parsed, err := url.Parse(raw)
	if err != nil {
		return 0
	}
	dur := strings.TrimSpace(parsed.Query().Get("dur"))
	if dur == "" {
		return 0
	}
	seconds, err := strconv.ParseFloat(dur, 64)
	if err != nil {
		return 0
	}
	return DurationMsFromSeconds(seconds)
}

func firstPositiveDurationMs(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

// WriteMetadataHeaders publishes yt-dlp duration/format so clients can ignore
// inflated HTML5 audio.duration from proxied AAC.
func WriteMetadataHeaders(w http.ResponseWriter, info *StreamInfo) {
	if w == nil || info == nil {
		return
	}
	if info.DurationMs > 0 {
		w.Header().Set(HeaderDurationMs, strconv.Itoa(info.DurationMs))
	}
	if ext := strings.TrimSpace(info.Ext); ext != "" {
		w.Header().Set(HeaderExt, ext)
	}
	if info.ContentType != "" && w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", info.ContentType)
	}
}

func ExposedAudioHeaders() string {
	return "Content-Range, Accept-Ranges, Content-Length, Content-Type, " +
		HeaderDurationMs + ", " + HeaderExt
}

func exposedAudioHeaders() string {
	return ExposedAudioHeaders()
}

func isPlayableUpstreamStatus(status int) bool {
	return status == http.StatusOK ||
		status == http.StatusPartialContent ||
		status == http.StatusNotModified
}

func looksLikeAudioContentType(contentType string) bool {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if ct == "" {
		return true
	}
	if strings.Contains(ct, "text/html") ||
		strings.Contains(ct, "application/json") ||
		strings.Contains(ct, "text/plain") {
		return false
	}
	return strings.HasPrefix(ct, "audio/") ||
		strings.HasPrefix(ct, "video/mp4") ||
		strings.HasPrefix(ct, "application/octet-stream")
}
