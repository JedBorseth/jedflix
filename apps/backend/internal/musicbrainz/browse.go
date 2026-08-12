package musicbrainz

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func (c *Client) refreshCatalog(ctx context.Context) {
	c.catalogMu.Lock()
	if c.refreshing {
		c.catalogMu.Unlock()
		c.waitForRefresh(ctx)
		return
	}
	c.refreshing = true
	c.catalogMu.Unlock()

	defer func() {
		c.catalogMu.Lock()
		c.refreshing = false
		c.catalogMu.Unlock()
	}()

	start := c.now()
	response, err := c.buildCatalog(ctx)
	if err != nil {
		log.Printf("music catalog refresh failed: %v", err)
		c.catalogMu.Lock()
		c.refreshErr = err
		c.catalogMu.Unlock()
		return
	}
	response.CachedAt = c.now().UnixMilli()
	c.applyCatalog(response)
	c.savePersistedCatalog(response)
	log.Printf("music catalog refreshed (%d rows, %d new releases) in %s",
		len(response.Rows), len(response.NewReleases), c.now().Sub(start).Round(time.Millisecond))
}

func (c *Client) waitForRefresh(ctx context.Context) {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		c.catalogMu.RLock()
		refreshing := c.refreshing
		hasCatalog := c.catalog != nil
		c.catalogMu.RUnlock()
		if !refreshing || hasCatalog {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (c *Client) buildCatalog(ctx context.Context) (*musiccatalog.BrowseResponse, error) {
	rows := make([]musiccatalog.CatalogRow, 0, len(c.genres)*3)
	for _, genre := range c.genres {
		if ctx.Err() != nil {
			break
		}
		genreRows, err := c.fetchGenreRows(ctx, genre)
		if err != nil {
			log.Printf("music catalog genre %s: %v", genre.Key, err)
			continue
		}
		rows = append(rows, genreRows...)
	}

	newReleases, err := c.fetchNewReleases(ctx)
	if err != nil {
		log.Printf("music catalog new releases: %v", err)
		newReleases = nil
	}

	if len(rows) == 0 && len(newReleases) == 0 {
		return nil, fmt.Errorf("%w: empty catalog", musiccatalog.ErrFetchFailed)
	}
	return &musiccatalog.BrowseResponse{
		NewReleases: newReleases,
		Rows:        rows,
	}, nil
}

func (c *Client) fetchGenreRows(ctx context.Context, genre musiccatalog.GenreConfig) ([]musiccatalog.CatalogRow, error) {
	query := strings.TrimSpace(genre.SearchQuery)
	if query == "" {
		query = genre.Title
	}

	artists := c.genreArtists(ctx, genre, query)
	albums := c.genreAlbums(ctx, genre, query, false)
	singles := c.genreAlbums(ctx, genre, query, true)

	rows := make([]musiccatalog.CatalogRow, 0, 3)
	if len(artists) > 0 {
		rows = append(rows, musiccatalog.CatalogRow{
			Title:   "Popular " + genre.Title + " Artists",
			Key:     genre.Key + "-artists",
			Kind:    "artists",
			Artists: artists,
		})
	}
	if len(albums) > 0 {
		rows = append(rows, musiccatalog.CatalogRow{
			Title:  "Popular " + genre.Title + " Albums",
			Key:    genre.Key + "-albums",
			Kind:   "albums",
			Albums: albums,
		})
	}
	if len(singles) > 0 {
		rows = append(rows, musiccatalog.CatalogRow{
			Title:  "Popular " + genre.Title + " Singles",
			Key:    genre.Key + "-singles",
			Kind:   "albums",
			Albums: singles,
		})
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("%w: no rows for %s", musiccatalog.ErrFetchFailed, genre.Key)
	}
	return rows, nil
}

func (c *Client) genreArtists(ctx context.Context, genre musiccatalog.GenreConfig, tag string) []musiccatalog.Artist {
	// Prefer Last.fm charts — includes MBIDs/images and avoids catalog stampede.
	if c.enricher != nil && c.enricher.Configured() {
		if hints, err := c.enricher.TagTopArtists(ctx, tag, catalogShelfLimit); err == nil && len(hints) > 0 {
			out := c.artistsFromHints(hints, catalogShelfLimit)
			if len(out) > 0 {
				return out
			}
		}
	}

	if searched, err := c.searchArtistsLocalOrRemote(ctx, tag, catalogShelfLimit); err == nil && len(searched) > 0 {
		return searched
	}

	// Last resort: seed names via local/remote resolve (capped).
	out := make([]musiccatalog.Artist, 0, catalogShelfLimit)
	seen := map[string]struct{}{}
	for _, seed := range genre.Seeds {
		if ctx.Err() != nil || len(out) >= catalogShelfLimit {
			break
		}
		artist, err := c.resolveArtistByName(ctx, seed)
		if err != nil || artist == nil || artist.ID == "" {
			continue
		}
		if _, ok := seen[artist.ID]; ok {
			continue
		}
		seen[artist.ID] = struct{}{}
		out = append(out, *artist)
	}
	return out
}

func (c *Client) genreAlbums(ctx context.Context, genre musiccatalog.GenreConfig, tag string, singles bool) []musiccatalog.Album {
	if singles {
		if c.useLocalSearch() {
			albums, err := c.searchAlbumsLocalOrRemote(ctx, tag, catalogShelfLimit, "Single")
			if err != nil {
				return nil
			}
			return albums
		}
		query := fmt.Sprintf(`tag:%s AND primarytype:Single`, luceneEscape(tag))
		albums, err := c.searchAlbums(ctx, query, catalogShelfLimit)
		if err != nil {
			return nil
		}
		return albums
	}

	if c.enricher != nil && c.enricher.Configured() {
		if hints, err := c.enricher.TagTopAlbums(ctx, tag, catalogShelfLimit); err == nil && len(hints) > 0 {
			out := c.albumsFromHints(ctx, hints, catalogShelfLimit)
			if len(out) > 0 {
				return out
			}
		}
	}

	if c.useLocalSearch() {
		albums, err := c.searchAlbumsLocalOrRemote(ctx, tag, catalogShelfLimit, "Album")
		if err != nil {
			return nil
		}
		return albums
	}
	query := fmt.Sprintf(`tag:%s AND primarytype:Album`, luceneEscape(tag))
	albums, err := c.searchAlbums(ctx, query, catalogShelfLimit)
	if err != nil {
		return nil
	}
	return albums
}

func (c *Client) fetchNewReleases(ctx context.Context) ([]musiccatalog.Album, error) {
	year := c.now().Year()
	if c.useLocalSearch() {
		// Meilisearch can't do date-range Lucene; approximate with year token + Album filter.
		albums, err := c.searchAlbumsLocalOrRemote(ctx, fmt.Sprintf("%d", year), catalogShelfLimit, "Album")
		if err != nil {
			return nil, err
		}
		return albums, nil
	}
	query := fmt.Sprintf(`primarytype:Album AND firstreleasedate:[%d-01-01 TO %d-12-31]`, year, year)
	albums, err := c.searchAlbums(ctx, query, catalogShelfLimit)
	if err != nil {
		return nil, err
	}
	return albums, nil
}

func (c *Client) artistsFromHints(hints []TagArtistHint, limit int) []musiccatalog.Artist {
	out := make([]musiccatalog.Artist, 0, limit)
	seen := map[string]struct{}{}
	for _, hint := range hints {
		id := NormalizeMBID(hint.MBID)
		if id == "" {
			// Skip entries without a stable MBID — detail pages need it.
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, musiccatalog.Artist{
			ID:       id,
			Name:     hint.Name,
			ImageURL: c.artistCoverURL(id),
			Genres:   []string{},
		})
		if len(out) >= limit {
			break
		}
	}
	return out
}

func (c *Client) albumsFromHints(ctx context.Context, hints []TagAlbumHint, limit int) []musiccatalog.Album {
	out := make([]musiccatalog.Album, 0, limit)
	seen := map[string]struct{}{}
	for _, hint := range hints {
		if ctx.Err() != nil {
			break
		}
		id := NormalizeMBID(hint.MBID)
		image := strings.TrimSpace(hint.ImageURL)
		artistID := NormalizeMBID(hint.ArtistMBID)
		artists := []string{}
		artistIDs := []string{}
		if hint.Artist != "" {
			artists = []string{hint.Artist}
		}
		if artistID != "" {
			artistIDs = []string{artistID}
		}

		if id == "" {
			// No album MBID — try a single MusicBrainz resolve (best effort).
			resolved, err := c.resolveAlbumByName(ctx, hint.Name, hint.Artist)
			if err != nil || resolved == nil || resolved.ID == "" {
				continue
			}
			id = resolved.ID
			if image == "" || strings.Contains(image, "placehold.co") {
				image = resolved.ImageURL
			}
			if len(artists) == 0 {
				artists = resolved.Artists
			}
			if len(artistIDs) == 0 {
				artistIDs = resolved.ArtistIDs
			}
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		// Always use the local CAA proxy cache for album art (homepage shelves included).
		image = c.coverURL(id)
		out = append(out, musiccatalog.Album{
			ID:        id,
			Name:      hint.Name,
			Artists:   artists,
			ArtistIDs: artistIDs,
			ImageURL:  image,
			AlbumType: "album",
			Genres:    []string{},
		})
		if len(out) >= limit {
			break
		}
	}
	return out
}
