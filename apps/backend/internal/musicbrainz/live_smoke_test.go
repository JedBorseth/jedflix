//go:build live

package musicbrainz

import (
	"context"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestLiveSearchRadiohead(t *testing.T) {
	c := NewClient(config.Config{
		MusicBrainzAPIBaseURL:  "https://musicbrainz.org/ws/2",
		CoverArtArchiveBaseURL: "https://coverartarchive.org",
		MusicCatalogCacheTTL:   time.Hour,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	res, err := c.Search(ctx, "Radiohead")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Artists) == 0 {
		t.Fatal("no artists")
	}
	t.Logf("artist %s %s", res.Artists[0].ID, res.Artists[0].Name)
	details, err := c.GetArtist(ctx, res.Artists[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("albums=%d discog=%d tops=%d", len(details.Albums), len(details.Discography), len(details.TopTracks))
	if len(details.Albums) == 0 {
		t.Fatal("no albums")
	}
	album, err := c.GetAlbum(ctx, details.Albums[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("album %q tracks=%d", album.Name, len(album.Tracks))
}
