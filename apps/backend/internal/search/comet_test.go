package search

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

// Shapes captured from comet.feels.legal (torrent-only mode, no config segment).
const cometFixture = `{"streams":[
{"name":"[TORRENT🧲] Comet 2160p","description":"📄 The.Shawshank.Redemption.1994.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.DTS-HD.MA.5.1-SyncTeam.mkv\n📹 hevc • DV • HDR • 10bit | 🔊 DTS Lossless • 5.1\n⭐ BluRay REMUX | 🏷️ SyncTeam\n💾 54.4 GB 🔎 DMM","behaviorHints":{"bingeGroup":"comet|torrent|051f7eb93f1f8956048c54651345e48954f203d1","filename":"The.Shawshank.Redemption.1994.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.DTS-HD.MA.5.1-SyncTeam.mkv","videoSize":58408797841},"infoHash":"051F7EB93F1F8956048C54651345E48954F203D1","fileIdx":0,"sources":["dht:051f7eb93f1f8956048c54651345e48954f203d1"]},
{"name":"[TORRENT🧲] Comet 1080p","description":"📄 Movie.2020.1080p.WEB-DL.x264-GRP.mp4\n📹 x264 | 🔊 AAC • 2.0\n⭐ WEB-DL | 🏷️ GRP\n👤 42 💾 2.1 GB 🔎 ThePirateBay\n🇬🇧/🇫🇷","behaviorHints":{"filename":""},"infoHash":"a02b4a5b46cb3e0b7d40032656f1b00b8bcda2bc"},
{"name":"[❌] Comet","description":"⚠ OBSOLETE CONFIGURATION, PLEASE RE-CONFIGURE"}
]}`

func TestCometSearcherParsesStreams(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(cometFixture))
	}))
	defer server.Close()

	searcher := NewCometSearcher(config.Config{CometURL: server.URL})
	releases, err := searcher.SearchEpisode(context.Background(), "0903747", 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/stream/series/tt0903747:1:2.json" {
		t.Fatalf("unexpected request path %q", gotPath)
	}
	if len(releases) != 2 {
		t.Fatalf("expected notice stream to be dropped, got %d releases", len(releases))
	}

	remux := releases[0]
	if remux.Title != "The.Shawshank.Redemption.1994.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.DTS-HD.MA.5.1-SyncTeam.mkv" {
		t.Errorf("title = %q", remux.Title)
	}
	if remux.InfoHash != "051f7eb93f1f8956048c54651345e48954f203d1" || remux.Magnet != "magnet:?xt=urn:btih:051f7eb93f1f8956048c54651345e48954f203d1" {
		t.Errorf("hash/magnet = %q / %q", remux.InfoHash, remux.Magnet)
	}
	if remux.FileIdx == nil || *remux.FileIdx != 0 {
		t.Errorf("fileIdx = %v", remux.FileIdx)
	}
	if !remux.SizeKnown || remux.SizeBytes != 58408797841 {
		t.Errorf("size = %d known=%v, want exact videoSize", remux.SizeBytes, remux.SizeKnown)
	}
	if remux.SeedersKnown {
		t.Errorf("DMM results carry no seeders, got %d", remux.Seeders)
	}
	if remux.Resolution != 2160 {
		t.Errorf("resolution = %d", remux.Resolution)
	}
	if remux.Info != "hevc · DV · HDR · 10bit · DTS Lossless · 5.1 · BluRay REMUX · SyncTeam" {
		t.Errorf("info = %q", remux.Info)
	}

	web := releases[1]
	gb := 2.1
	wantWebSize := int64(gb * 1024 * 1024 * 1024)
	if web.Title != "Movie.2020.1080p.WEB-DL.x264-GRP.mp4" {
		t.Errorf("title should fall back to the 📄 line, got %q", web.Title)
	}
	if web.FileIdx != nil {
		t.Errorf("fileIdx should be nil when Comet omits it")
	}
	if !web.SeedersKnown || web.Seeders != 42 {
		t.Errorf("seeders = %d known=%v", web.Seeders, web.SeedersKnown)
	}
	if !web.SizeKnown || web.SizeBytes != wantWebSize {
		t.Errorf("size should be parsed from the 💾 line, got %d", web.SizeBytes)
	}
	if web.Info != "x264 · AAC · 2.0 · WEB-DL · GRP" {
		t.Errorf("info = %q (flag-only line should be dropped)", web.Info)
	}

	if !IsDirectPlaybackIncompatible(remux.Title+" "+remux.Info) || IsDirectPlaybackIncompatible(web.Title+" "+web.Info) {
		t.Errorf("compat filter misclassified Comet releases")
	}
}

func TestCometSearcherReportsHTTPErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Forbidden", http.StatusForbidden)
	}))
	defer server.Close()

	_, err := NewCometSearcher(config.Config{CometURL: server.URL}).SearchMovie(context.Background(), "tt0111161")
	if err == nil || err.Error() != "comet returned 403: Forbidden" {
		t.Fatalf("err = %v", err)
	}
}
