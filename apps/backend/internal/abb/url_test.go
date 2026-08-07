package abb

import "testing"

func TestValidateFetchURLAllowsRelativeAndSameHost(t *testing.T) {
	c := NewClient("https://audiobookbay.lu", nil)

	got, err := c.validateFetchURL("/?s=foo")
	if err != nil {
		t.Fatalf("relative: %v", err)
	}
	if got != "https://audiobookbay.lu/?s=foo" {
		t.Fatalf("got %q", got)
	}

	got, err = c.validateFetchURL("https://audiobookbay.lu/foo/bar")
	if err != nil {
		t.Fatalf("absolute same host: %v", err)
	}
	if got != "https://audiobookbay.lu/foo/bar" {
		t.Fatalf("got %q", got)
	}
}

func TestValidateFetchURLRejectsSSRF(t *testing.T) {
	c := NewClient("https://audiobookbay.lu", nil)
	cases := []string{
		"http://127.0.0.1/",
		"https://169.254.169.254/latest/meta-data/",
		"https://evil.example/steal",
		"file:///etc/passwd",
		"https://audiobookbay.lu@evil.example/",
	}
	for _, raw := range cases {
		if _, err := c.validateFetchURL(raw); err == nil {
			t.Fatalf("expected rejection for %q", raw)
		}
	}
}
