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

func (c *Client) withArtistImageURLs(artists []musiccatalog.Artist) []musiccatalog.Artist {
	out := make([]musiccatalog.Artist, len(artists))
	for i, artist := range artists {
		if artist.ID != "" {
			artist.ImageURL = c.artistCoverURL(artist.ID)
		} else if !usableImageURL(artist.ImageURL) {
			artist.ImageURL = fallbackImage
		}
		out[i] = artist
	}
	return out
}

func (c *Client) withTrackCoverURLs(ctx context.Context, tracks []musiccatalog.TopTrack) []musiccatalog.TopTrack {
	out := make([]musiccatalog.TopTrack, len(tracks))
	for i, track := range tracks {
		out[i] = c.enrichTrackArtwork(ctx, track)
	}
	return out
}

func (c *Client) enrichTrackArtwork(ctx context.Context, track musiccatalog.TopTrack) musiccatalog.TopTrack {
	if track.AlbumID != "" && track.DurationMs > 0 {
		track.ImageURL = c.coverURL(track.AlbumID)
		return track
	}
	if c.useLocalStore() {
		if id := NormalizeMBID(track.ID); id != "" {
			if detailed, err := c.local.GetRecording(ctx, id); err == nil && detailed != nil {
				track = mergeRecordingAlbum(track, detailed)
			}
		}
	}
	if track.AlbumID != "" {
		track.ImageURL = c.coverURL(track.AlbumID)
	} else if !usableImageURL(track.ImageURL) {
		track.ImageURL = fallbackImage
	}
	return track
}

func mergeRecordingAlbum(track musiccatalog.TopTrack, detailed *musiccatalog.TopTrack) musiccatalog.TopTrack {
	if detailed.AlbumID != "" {
		track.AlbumID = detailed.AlbumID
	}
	if detailed.AlbumName != "" {
		track.AlbumName = detailed.AlbumName
	}
	if track.ID == "" || strings.HasPrefix(track.ID, "lfm:") {
		track.ID = detailed.ID
	}
	if track.DurationMs <= 0 && detailed.DurationMs > 0 {
		track.DurationMs = detailed.DurationMs
	}
	return track
}

func (c *Client) fetchArtistDetailsLocal(ctx context.Context, artistID string) (*musiccatalog.ArtistDetails, error) {
	details, err := c.local.GetArtist(ctx, artistID)
	if err != nil {
		return nil, err
	}
	details.Artist.ImageURL = c.artistCoverURL(details.Artist.ID)
	details.Albums = c.withCoverURLs(details.Albums)
	details.Discography = c.withCoverURLs(details.Discography)
	details.TopTracks = c.fetchTopTracks(ctx, details.Artist)
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
		return c.withArtistImageURLs(artists), nil
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
		return c.withTrackCoverURLs(ctx, tracks), nil
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
