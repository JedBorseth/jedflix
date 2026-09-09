package config

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"golang.org/x/net/proxy"
)

func applyForwardProxy(transport *http.Transport, raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("ABB_PROXY: %w", err)
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
		transport.Proxy = http.ProxyURL(parsed)
		return nil
	case "socks5", "socks5h":
		dialer, err := proxy.FromURL(parsed, proxy.Direct)
		if err != nil {
			return fmt.Errorf("ABB_PROXY: %w", err)
		}
		contextDialer, ok := dialer.(proxy.ContextDialer)
		if !ok {
			return fmt.Errorf("ABB_PROXY: socks5 dialer does not support DialContext")
		}
		transport.Proxy = func(*http.Request) (*url.URL, error) { return nil, nil }
		transport.DialContext = contextDialer.DialContext
		return nil
	default:
		return fmt.Errorf("ABB_PROXY: unsupported scheme %q", parsed.Scheme)
	}
}
