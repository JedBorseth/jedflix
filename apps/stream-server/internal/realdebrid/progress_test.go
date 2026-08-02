package realdebrid

import (
	"strings"
	"testing"
)

func TestFormatTorrentProgress(t *testing.T) {
	msg := FormatTorrentProgress(&TorrentInfo{
		Status:   "downloading",
		Progress: 42,
		Seeders:  7,
		Speed:    2 * 1024 * 1024,
	})
	for _, part := range []string{"42%", "7 seeders", "MB/s", "downloading"} {
		if !strings.Contains(msg, part) {
			t.Fatalf("expected %q in %q", part, msg)
		}
	}
}

func TestFormatTorrentProgressZeroSeeders(t *testing.T) {
	msg := FormatTorrentProgress(&TorrentInfo{
		Status:   "downloading",
		Progress: 5,
		Seeders:  0,
	})
	if !strings.Contains(msg, "0 seeders") {
		t.Fatalf("expected 0 seeders in %q", msg)
	}
}
