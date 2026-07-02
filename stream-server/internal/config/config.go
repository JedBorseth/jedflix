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
	Addr               string
	RealDebridToken    string
	TorrentioURL       string
	MaxVideoSizeGB     float64
	MinSeeders         int
	PreferInstant      bool
	BlockedKeywords    []string
	MaxResolution      int
	StreamServerAPIKey string
	ProxySigningSecret string
	CORSOrigins        []string
	HTTPProxy          string
	HTTPSProxy         string
	ResolveTimeout     time.Duration
}

func Load() Config {
	cfg := Config{
		Addr:               envOr("ADDR", ":8080"),
		RealDebridToken:    strings.TrimSpace(os.Getenv("REALDEBRID_TOKEN")),
		TorrentioURL:       strings.TrimRight(envOr("TORRENTIO_URL", "https://torrentio.strem.fun"), "/"),
		MaxVideoSizeGB:     envFloat("MAX_VIDEO_SIZE_GB", 50),
		MinSeeders:         envInt("MIN_SEEDERS", 3),
		PreferInstant:      envBool("PREFER_INSTANT", true),
		BlockedKeywords:    splitCSV(envOr("BLOCKED_KEYWORDS", "cam,ts,telesync,hdcam")),
		MaxResolution:      envInt("MAX_RESOLUTION", 2160),
		StreamServerAPIKey: os.Getenv("STREAM_SERVER_API_KEY"),
		ProxySigningSecret: envOr("PROXY_SIGNING_SECRET", "change-me-in-production"),
		CORSOrigins:        splitCSV(envOr("CORS_ORIGINS", "http://localhost:5173")),
		HTTPProxy:          os.Getenv("HTTP_PROXY"),
		HTTPSProxy:         os.Getenv("HTTPS_PROXY"),
		ResolveTimeout:     time.Duration(envInt("RESOLVE_TIMEOUT_SECONDS", 600)) * time.Second,
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
