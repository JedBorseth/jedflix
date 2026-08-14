package musicbrainz

import (
	"context"
	"log"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func (c *Client) scheduleHomepageArtistWarm(browse *musiccatalog.BrowseResponse) {
	if !c.useLocalStore() {
		return
	}
	ids := collectHomepageArtistIDs(browse)
	if len(ids) == 0 {
		return
	}

	c.catalogMu.Lock()
	if c.artistWarming {
		c.catalogMu.Unlock()
		return
	}
	c.artistWarming = true
	c.catalogMu.Unlock()

	go c.warmHomepageArtists(ids)
}

func (c *Client) warmHomepageArtists(ids []string) {
	defer func() {
		c.catalogMu.Lock()
		c.artistWarming = false
		c.catalogMu.Unlock()
	}()

	warmed := 0
	skipped := 0
	for _, id := range ids {
		if c.artistPageCached(id) {
			skipped++
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), homepageArtistWarmTimeout)
		_, err := c.GetArtistWithHints(ctx, id, musiccatalog.ArtistHints{})
		cancel()
		if err != nil {
			log.Printf("homepage artist warm %s: %v", id, err)
		} else {
			warmed++
		}

		timer := time.NewTimer(homepageArtistWarmGap)
		<-timer.C
	}
	log.Printf("homepage artist cache warm finished (%d warmed, %d already cached, %d queued)", warmed, skipped, len(ids))
}

func (c *Client) artistPageCached(artistID string) bool {
	artistID = NormalizeMBID(artistID)
	if artistID == "" {
		return false
	}
	cached, ok := c.artistCache.Load(artistID)
	if !ok {
		return false
	}
	entry, ok := cached.(cachedArtist)
	if !ok {
		return false
	}
	return c.now().Sub(entry.cachedAt) < c.refreshTTL
}

func collectHomepageArtistIDs(browse *musiccatalog.BrowseResponse) []string {
	if browse == nil {
		return nil
	}
	out := make([]string, 0)
	seen := map[string]struct{}{}
	add := func(id string) {
		id = NormalizeMBID(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, album := range browse.NewReleases {
		for _, id := range album.ArtistIDs {
			add(id)
		}
	}
	for _, row := range browse.Rows {
		for _, artist := range row.Artists {
			add(artist.ID)
		}
		for _, album := range row.Albums {
			for _, id := range album.ArtistIDs {
				add(id)
			}
		}
	}
	return out
}
