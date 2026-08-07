package musicbrainz

import (
	"context"
	"fmt"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func (c *Client) withCoverURLs(albums []musiccatalog.Album) []musiccatalog.Album {
	out := make([]musiccatalog.Album, len(albums))
	for i, album := range albums {
		album.ImageURL = c.coverURL(album.ID)
		out[i] = album
	}
	return out
}

func (c *Client) withTrackCoverURLs(tracks []musiccatalog.TopTrack) []musiccatalog.TopTrack {
	out := make([]musiccatalog.TopTrack, len(tracks))
	for i, track := range tracks {
		if track.AlbumID != "" {
			track.ImageURL = c.coverURL(track.AlbumID)
		} else if track.ImageURL == "" {
			track.ImageURL = fallbackImage
		}
		out[i] = track
	}
	return out
}

func (c *Client) fetchArtistDetailsLocal(ctx context.Context, artistID string) (*musiccatalog.ArtistDetails, error) {
	details, err := c.local.GetArtist(ctx, artistID)
	if err != nil {
		return nil, err
	}
	details.Artist.ImageURL = c.artistImage(ctx, details.Artist.Name)
	details.Albums = c.withCoverURLs(details.Albums)
	details.Discography = c.withCoverURLs(details.Discography)
	details.TopTracks = c.fetchTopTracks(ctx, details.Artist)
	details.TopTracks = c.withTrackCoverURLs(details.TopTracks)
	return details, nil
}

func (c *Client) useLocalSearch() bool {
	return c.search != nil && c.search.Configured()
}

func (c *Client) useLocalStore() bool {
	return c.local != nil && c.local.Configured()
}

// searchArtists prefers Meilisearch when configured (no public MusicBrainz API).
func (c *Client) searchArtistsLocalOrRemote(ctx context.Context, query string, limit int) ([]musiccatalog.Artist, error) {
	if c.useLocalSearch() {
		artists, err := c.search.SearchArtists(ctx, query, limit)
		if err != nil {
			return nil, err
		}
		for i := range artists {
			if artists[i].ImageURL == "" {
				artists[i].ImageURL = fallbackImage
			}
		}
		return artists, nil
	}
	return c.searchArtists(ctx, query, limit)
}

func (c *Client) searchAlbumsLocalOrRemote(ctx context.Context, query string, limit int, primaryType string) ([]musiccatalog.Album, error) {
	if c.useLocalSearch() {
		filter := ""
		if primaryType != "" {
			filter = fmt.Sprintf(`primaryType = "%s"`, primaryType)
		}
		// Strip Lucene-ish operators for Meilisearch plain queries.
		plain := stripLucene(query)
		albums, err := c.search.SearchReleaseGroups(ctx, plain, filter, limit)
		if err != nil {
			return nil, err
		}
		return c.withCoverURLs(albums), nil
	}
	return c.searchAlbums(ctx, query, limit)
}

func (c *Client) searchRecordingsLocalOrRemote(ctx context.Context, query string, limit int) ([]musiccatalog.TopTrack, error) {
	if c.useLocalSearch() {
		tracks, err := c.search.SearchRecordings(ctx, stripLucene(query), limit)
		if err != nil {
			return nil, err
		}
		return c.withTrackCoverURLs(tracks), nil
	}
	return c.searchRecordings(ctx, query, limit)
}

func stripLucene(query string) string {
	q := query
	for _, prefix := range []string{
		"tag:", "artist:", "recording:", "releasegroup:", "primarytype:",
	} {
		// Best-effort: drop fielded Lucene when talking to Meilisearch.
		_ = prefix
	}
	replacer := strings.NewReplacer(
		`AND`, " ",
		`OR`, " ",
		`NOT`, " ",
		`"`, " ",
		`(`, " ",
		`)`, " ",
		`[`, " ",
		`]`, " ",
		`{`, " ",
		`}`, " ",
		`:`, " ",
		`*`, " ",
	)
	parts := strings.Fields(replacer.Replace(q))
	filtered := make([]string, 0, len(parts))
	for _, p := range parts {
		lower := strings.ToLower(p)
		if strings.HasPrefix(lower, "primarytype") || strings.HasPrefix(lower, "firstreleasedate") {
			continue
		}
		if lower == "album" || lower == "ep" || lower == "single" {
			// Likely a type token from Lucene queries — skip for plain search.
			continue
		}
		filtered = append(filtered, p)
	}
	return strings.TrimSpace(strings.Join(filtered, " "))
}
