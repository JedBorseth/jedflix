package musicbrainz

import (
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func TestCollectHomepageArtistIDs(t *testing.T) {
	t.Parallel()
	dup := "a74b1b7f-71a5-4011-9441-d0b5e4122711"
	other := "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d"
	ids := collectHomepageArtistIDs(&musiccatalog.BrowseResponse{
		NewReleases: []musiccatalog.Album{{
			ID:        "11111111-1111-1111-1111-111111111111",
			ArtistIDs: []string{dup},
		}},
		Rows: []musiccatalog.CatalogRow{
			{
				Kind: "artists",
				Artists: []musiccatalog.Artist{
					{ID: dup, Name: "Radiohead"},
					{ID: other, Name: "Thom Yorke"},
					{ID: "not-an-mbid", Name: "Skip"},
				},
			},
			{
				Kind: "albums",
				Albums: []musiccatalog.Album{{
					ID:        "22222222-2222-2222-2222-222222222222",
					ArtistIDs: []string{dup, other},
				}},
			},
		},
	})
	if len(ids) != 2 {
		t.Fatalf("ids = %#v", ids)
	}
	if ids[0] != dup || ids[1] != other {
		t.Fatalf("ids = %#v", ids)
	}
}

func TestArtistPageCached(t *testing.T) {
	t.Parallel()
	client := NewClient(config.Config{MusicCatalogCacheTTL: time.Hour})
	id := "a74b1b7f-71a5-4011-9441-d0b5e4122711"
	if client.artistPageCached(id) {
		t.Fatal("expected miss")
	}
	client.artistCache.Store(id, cachedArtist{
		artist:   musiccatalog.ArtistDetails{Artist: musiccatalog.Artist{ID: id, Name: "Radiohead"}},
		cachedAt: client.now(),
	})
	if !client.artistPageCached(id) {
		t.Fatal("expected hit")
	}
}

func TestScheduleHomepageArtistWarmSkipsWithoutLocalStore(t *testing.T) {
	t.Parallel()
	client := NewClient(config.Config{})
	client.scheduleHomepageArtistWarm(&musiccatalog.BrowseResponse{
		Rows: []musiccatalog.CatalogRow{{
			Artists: []musiccatalog.Artist{{ID: "a74b1b7f-71a5-4011-9441-d0b5e4122711"}},
		}},
	})
	client.catalogMu.RLock()
	warming := client.artistWarming
	client.catalogMu.RUnlock()
	if warming {
		t.Fatal("should not warm artist pages without local MusicBrainz")
	}
}
