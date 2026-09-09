package abb

import (
	"errors"
	"net"
	"os"
	"strings"
	"testing"
)

// TestLiveAudiobookBayMarkupStillParses fetches real ABB pages and asserts the
// scraper still finds search hits and a magnet. Failures here mean the site UI
// changed again — not that ranking or Real Debrid broke.
func TestLiveAudiobookBayMarkupStillParses(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live AudiobookBay contract in short mode")
	}

	client := NewClient(strings.TrimSpace(os.Getenv("ABB_BASE_URL")), nil)

	results, err := client.Search("project hail mary")
	if skipIfABBUnreachable(t, err) {
		return
	}
	if err != nil {
		t.Fatalf("ABB search failed (UI or endpoint change?): %v", err)
	}
	if len(results) == 0 {
		t.Fatal("ABB search HTML returned no parseable posts; selectors likely drifted")
	}

	var postURL string
	matched := 0
	for _, result := range results {
		if strings.Contains(strings.ToLower(result.Title), "hail mary") {
			matched++
			if postURL == "" {
				postURL = result.URL
			}
		}
	}
	if matched == 0 {
		titles := make([]string, 0, len(results))
		for _, result := range results {
			titles = append(titles, result.Title)
		}
		t.Fatalf("ABB search for %q returned posts that don't match the query (got %q). Header search without tt=1 mixes in homepage listings.", "project hail mary", titles)
	}

	post, err := client.GetPost(postURL)
	if skipIfABBUnreachable(t, err) {
		return
	}
	if err != nil {
		t.Fatalf("ABB post parse failed (magnet/info-hash markup changed?): %v", err)
	}
	if !strings.HasPrefix(post.Magnet, "magnet:?xt=urn:btih:") {
		t.Fatalf("expected magnet from live post, got %q", post.Magnet)
	}
}

func skipIfABBUnreachable(t *testing.T, err error) bool {
	t.Helper()
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		t.Skipf("AudiobookBay unreachable from this network: %v", err)
		return true
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "timeout") ||
		strings.Contains(msg, "timed out") ||
		strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "network is unreachable") ||
		strings.Contains(msg, "tls handshake") {
		t.Skipf("AudiobookBay unreachable from this network: %v", err)
		return true
	}
	return false
}
