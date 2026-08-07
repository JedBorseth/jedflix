package config

import (
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr                   string
	RealDebridToken        string
	TorrentioURL           string
	MaxVideoSizeGB         float64
	MinSeeders             int
	PreferInstant          bool
	BlockedKeywords        []string
	RDBlockedFilenameRegex string
	MaxResolution          int
	// BackendAPIKey gates /api/v1 (except public cover proxies). Accepts
	// BACKEND_API_KEY with legacy STREAM_SERVER_API_KEY fallback.
	BackendAPIKey string
	// RequireAPIKey forces fail-closed auth when true (default in production).
	RequireAPIKey              bool
	CORSOrigins                []string
	HTTPProxy                  string
	HTTPSProxy                 string
	ResolveTimeout             time.Duration
	MaxConcurrentResolves      int
	MaxConcurrentYoutube       int
	LetterboxdBaseURL          string
	LetterboxdCacheTTL         time.Duration
	OpenLibraryBaseURL         string
	OpenLibraryCacheTTL        time.Duration
	OpenLibraryCoverPublicBase string
	OpenLibraryCoversBaseURL   string
	SpotifyClientID            string
	SpotifyClientSecret        string
	SpotifyAPIBaseURL          string
	SpotifyAuthURL             string
	SpotifyCacheTTL            time.Duration
	AbbBaseURL                 string
	AbbUsername                string
	AbbPassword                string
}

func Load() Config {
	apiKey := firstNonEmpty(
		strings.TrimSpace(os.Getenv("BACKEND_API_KEY")),
		strings.TrimSpace(os.Getenv("STREAM_SERVER_API_KEY")),
	)
	cfg := Config{
		Addr:                       envOr("ADDR", ":8080"),
		RealDebridToken:            strings.TrimSpace(os.Getenv("REALDEBRID_TOKEN")),
		TorrentioURL:               strings.TrimRight(envOr("TORRENTIO_URL", "https://torrentio.strem.fun"), "/"),
		MaxVideoSizeGB:             envFloat("MAX_VIDEO_SIZE_GB", 50),
		MinSeeders:                 envInt("MIN_SEEDERS", 3),
		PreferInstant:              envBool("PREFER_INSTANT", true),
		BlockedKeywords:            splitCSV(envOr("BLOCKED_KEYWORDS", "cam,ts,telesync,hdcam")),
		RDBlockedFilenameRegex:     envOr("RD_BLOCKED_FILENAME_REGEX", `web-dl|webrip|bdrip|hdrip|dvdrip|BluRay\.x264|HDTV\.x264|HDTV\.XviD|WEB\.x264|WEB\.h264`),
		MaxResolution:              envInt("MAX_RESOLUTION", 2160),
		BackendAPIKey:              apiKey,
		RequireAPIKey:              envBool("REQUIRE_API_KEY", isProduction()),
		CORSOrigins:                splitOrigins(envOr("CORS_ORIGINS", "http://localhost:5173")),
		HTTPProxy:                  os.Getenv("HTTP_PROXY"),
		HTTPSProxy:                 os.Getenv("HTTPS_PROXY"),
		ResolveTimeout:             time.Duration(envInt("RESOLVE_TIMEOUT_SECONDS", 600)) * time.Second,
		MaxConcurrentResolves:      envInt("MAX_CONCURRENT_RESOLVES", 6),
		MaxConcurrentYoutube:       envInt("MAX_CONCURRENT_YOUTUBE", 3),
		LetterboxdBaseURL:          strings.TrimRight(envOr("LETTERBOXD_BASE_URL", "https://letterboxd.com"), "/"),
		LetterboxdCacheTTL:         envDuration("LETTERBOXD_CACHE_TTL", time.Hour),
		OpenLibraryBaseURL:         strings.TrimRight(envOr("OPEN_LIBRARY_BASE_URL", "https://openlibrary.org"), "/"),
		OpenLibraryCacheTTL:        envDuration("OPEN_LIBRARY_CACHE_TTL", 12*time.Hour),
		OpenLibraryCoverPublicBase: strings.TrimRight(envOr("OPEN_LIBRARY_COVER_PUBLIC_BASE", "/backend/api/v1/openlibrary/covers"), "/"),
		OpenLibraryCoversBaseURL:   strings.TrimRight(envOr("OPEN_LIBRARY_COVERS_BASE_URL", "https://covers.openlibrary.org"), "/"),
		SpotifyClientID:            strings.TrimSpace(os.Getenv("SPOTIFY_CLIENT_ID")),
		SpotifyClientSecret:        strings.TrimSpace(os.Getenv("SPOTIFY_CLIENT_SECRET")),
		SpotifyAPIBaseURL:          strings.TrimRight(envOr("SPOTIFY_API_BASE_URL", "https://api.spotify.com/v1"), "/"),
		SpotifyAuthURL:             strings.TrimRight(envOr("SPOTIFY_AUTH_URL", "https://accounts.spotify.com/api/token"), "/"),
		SpotifyCacheTTL:            envDuration("SPOTIFY_CACHE_TTL", 6*time.Hour),
		AbbBaseURL:                 strings.TrimRight(envOr("ABB_BASE_URL", "https://audiobookbay.lu"), "/"),
		AbbUsername:                strings.TrimSpace(os.Getenv("ABB_USERNAME")),
		AbbPassword:                os.Getenv("ABB_PASSWORD"),
	}
	return cfg
}

func (c Config) HTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	proxyURL := c.HTTPSProxy
	if proxyURL == "" {
		proxyURL = c.HTTPProxy
	}
	if proxyURL != "" {
		if parsed, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(parsed)
		}
	}
	return &http.Client{
		Timeout:   30 * time.Second,
		Transport: transport,
	}
}

func isProduction() bool {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("ENV")))
	if env == "" {
		env = strings.ToLower(strings.TrimSpace(os.Getenv("GO_ENV")))
	}
	switch env {
	case "production", "prod":
		return true
	default:
		// Docker compose / Caddy deploy typically sets DOMAIN.
		return strings.TrimSpace(os.Getenv("DOMAIN")) != ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func envFloat(key string, fallback float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return fallback
	}
	return n
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(strings.ToLower(part))
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

// splitOrigins keeps host casing (unlike keyword CSV) but trims whitespace.
func splitOrigins(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
