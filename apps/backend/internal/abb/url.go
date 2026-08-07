package abb

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// validateFetchURL ensures pathOrURL resolves to the configured ABB host only.
// Absolute client-supplied URLs are a classic SSRF vector — reject anything else.
func (c *Client) validateFetchURL(pathOrURL string) (string, error) {
	pathOrURL = strings.TrimSpace(pathOrURL)
	if pathOrURL == "" {
		return "", fmt.Errorf("empty ABB URL")
	}

	base, err := url.Parse(c.baseURL)
	if err != nil || base.Host == "" {
		return "", fmt.Errorf("invalid ABB base URL")
	}

	var target *url.URL
	if strings.Contains(pathOrURL, "://") {
		target, err = url.Parse(pathOrURL)
		if err != nil {
			return "", fmt.Errorf("invalid ABB URL")
		}
		if target.Scheme != "https" && target.Scheme != "http" {
			return "", fmt.Errorf("ABB URL scheme not allowed")
		}
	} else {
		if !strings.HasPrefix(pathOrURL, "/") {
			pathOrURL = "/" + pathOrURL
		}
		target, err = base.Parse(pathOrURL)
		if err != nil {
			return "", fmt.Errorf("invalid ABB path")
		}
	}

	if target.Scheme != "https" && target.Scheme != "http" {
		return "", fmt.Errorf("ABB URL scheme not allowed")
	}
	if target.User != nil {
		return "", fmt.Errorf("ABB URL must not include credentials")
	}
	if !hostsEqual(base.Hostname(), target.Hostname()) {
		return "", fmt.Errorf("ABB URL host not allowed")
	}
	if ip := net.ParseIP(target.Hostname()); ip != nil {
		return "", fmt.Errorf("ABB URL host not allowed")
	}
	// Drop fragments; keep query (ABB search uses ?s=).
	target.Fragment = ""
	return target.String(), nil
}

func hostsEqual(a, b string) bool {
	a = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(a)), ".")
	b = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(b)), ".")
	return a != "" && a == b
}
