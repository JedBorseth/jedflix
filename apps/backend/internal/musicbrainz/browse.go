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
		log.Printf("musicbrainz catalog refresh failed: %v", err)
		c.catalogMu.Lock()
		c.refreshErr = err
		c.catalogMu.Unlock()
		return
	}
	response.CachedAt = c.now().UnixMilli()
	c.applyCatalog(response)
	c.savePersistedCatalog(response)
	log.Printf("musicbrainz catalog refreshed (%d rows, %d new releases) in %s",
		len(response.Rows), len(response.NewReleases), c.now().Sub(start).Round(time.Millisecond))
}

func (c *Client) buildCatalog(ctx context.Context) (*musiccatalog.BrowseResponse, error) {
	rows := make([]musiccatalog.CatalogRow, 0, len(c.genres)*3)
	for _, genre := range c.genres {
		if ctx.Err() != nil {
			break
		}
		genreRows, err := c.fetchGenreRows(ctx, genre)
		if err != nil {
			log.Printf("musicbrainz genre %s: %v", genre.Key, err)
			continue
		}
		rows = append(rows, genreRows...)
	}

	newReleases, err := c.fetchNewReleases(ctx)
	if err != nil {
		log.Printf("musicbrainz new releases: %v", err)
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
	names := make([]string, 0, catalogShelfLimit)
	if c.enricher != nil && c.enricher.Configured() {
		if top, err := c.enricher.TagTopArtists(ctx, tag, catalogShelfLimit); err == nil {
			names = append(names, top...)
		}
	}
	if len(names) == 0 {
		for _, seed := range genre.Seeds {
			if len(names) >= catalogShelfLimit {
				break
			}
			names = append(names, seed)
		}
	}

	out := make([]musiccatalog.Artist, 0, len(names))
	seen := map[string]struct{}{}
	for _, name := range names {
		if ctx.Err() != nil {
			break
		}
		artist, err := c.resolveArtistByName(ctx, name)
		if err != nil || artist == nil || artist.ID == "" {
			continue
		}
		if _, ok := seen[artist.ID]; ok {
			continue
		}
		seen[artist.ID] = struct{}{}
		out = append(out, *artist)
		if len(out) >= catalogShelfLimit {
			break
		}
	}

	// Tag search fallback when seeds fail.
	if len(out) == 0 {
		searched, err := c.searchArtists(ctx, `tag:`+luceneEscape(tag), catalogShelfLimit)
		if err == nil {
			return searched
		}
	}
	return out
}

func (c *Client) genreAlbums(ctx context.Context, genre musiccatalog.GenreConfig, tag string, singles bool) []musiccatalog.Album {
	if c.enricher != nil && c.enricher.Configured() && !singles {
		if hints, err := c.enricher.TagTopAlbums(ctx, tag, catalogShelfLimit); err == nil && len(hints) > 0 {
			out := make([]musiccatalog.Album, 0, len(hints))
			seen := map[string]struct{}{}
			for _, hint := range hints {
				if ctx.Err() != nil {
					break
				}
				album, err := c.resolveAlbumByName(ctx, hint.Name, hint.Artist)
				if err != nil || album == nil || album.ID == "" {
					continue
				}
				if _, ok := seen[album.ID]; ok {
					continue
				}
				seen[album.ID] = struct{}{}
				out = append(out, *album)
				if len(out) >= catalogShelfLimit {
					break
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}

	primary := "Album"
	if singles {
		primary = "Single"
	}
	query := fmt.Sprintf(`tag:%s AND primarytype:%s`, luceneEscape(tag), primary)
	albums, err := c.searchAlbums(ctx, query, catalogShelfLimit)
	if err != nil {
		return nil
	}
	return albums
}

func (c *Client) fetchNewReleases(ctx context.Context) ([]musiccatalog.Album, error) {
	// Approximate "new" via recent first-release-date window.
	year := c.now().Year()
	query := fmt.Sprintf(`primarytype:Album AND firstreleasedate:[%d-01-01 TO %d-12-31]`, year, year)
	return c.searchAlbums(ctx, query, catalogShelfLimit)
}
