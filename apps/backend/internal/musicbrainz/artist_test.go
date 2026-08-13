package musicbrainz

import (
	"context"
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func TestFinalizeTopTrackUsesAlbumCoverNotArtistImage(t *testing.T) {
	client := NewClient(config.Config{MusicCoverPublicBase: "/backend/api/v1/music/covers"})
	artist := musiccatalog.Artist{
		ID:       "a74b1b7f-71a5-4011-9441-d0b5e4122711",
		Name:     "Radiohead",
		ImageURL: "/backend/api/v1/music/covers/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711.jpg",
	}
	albumID := "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
	got := client.finalizeTopTrack(artist, &musiccatalog.TopTrack{
		ID:         "rec-1",
		Name:       "Karma Police",
		AlbumID:    albumID,
		DurationMs: 261000,
	})
	if got.ImageURL != "/backend/api/v1/music/covers/release-group/"+albumID+".jpg" {
		t.Fatalf("image=%q", got.ImageURL)
	}
	if got.DurationMs != 261000 {
		t.Fatalf("duration=%d", got.DurationMs)
	}

	missing := client.finalizeTopTrack(artist, &musiccatalog.TopTrack{
		ID:   "rec-2",
		Name: "Unknown",
	})
	if missing.ImageURL != fallbackImage {
		t.Fatalf("expected placeholder, got %q", missing.ImageURL)
	}
	if missing.ImageURL == artist.ImageURL {
		t.Fatal("top tracks must not reuse the artist image")
	}
}

func TestPickResolvedTrackPrefersExactNameWithAlbum(t *testing.T) {
	hint := musiccatalog.TopTrack{Name: "Karma Police"}
	best := pickResolvedTrack(hint, []musiccatalog.TopTrack{
		{ID: "a", Name: "Karma Police (live)", AlbumID: "live", DurationMs: 200000},
		{ID: "b", Name: "Karma Police", AlbumID: "ok-computer", DurationMs: 261000},
		{ID: "c", Name: "Creep", AlbumID: "pb", DurationMs: 238000},
	})
	if best == nil || best.ID != "b" {
		t.Fatalf("best=%#v", best)
	}
}

func TestEnrichTrackArtworkSkipsLookupWhenComplete(t *testing.T) {
	client := NewClient(config.Config{MusicCoverPublicBase: "/backend/api/v1/music/covers"})
	albumID := "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
	got := client.enrichTrackArtwork(context.Background(), musiccatalog.TopTrack{
		ID:         "rec-1",
		Name:       "Karma Police",
		AlbumID:    albumID,
		DurationMs: 261000,
		ImageURL:   "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png",
	})
	if got.ImageURL != "/backend/api/v1/music/covers/release-group/"+albumID+".jpg" {
		t.Fatalf("image=%q", got.ImageURL)
	}
	if got.DurationMs != 261000 {
		t.Fatalf("duration=%d", got.DurationMs)
	}
}
