package musicbrainz

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func (c *Client) fetchArtistDetails(ctx context.Context, artistID string) (*musiccatalog.ArtistDetails, error) {
	params := url.Values{}
	params.Set("inc", "tags")
	var payload mbArtist
	if err := c.getJSON(ctx, "/artist/"+artistID, params, &payload); err != nil {
		return nil, err
	}
	artist := mapArtist(payload)
	artist.ImageURL = c.artistImage(ctx, artist.Name)

	groups, err := c.browseArtistReleaseGroups(ctx, artistID, discographyLimit)
	if err != nil {
		return nil, err
	}

	albums := make([]musiccatalog.Album, 0)
	discography := make([]musiccatalog.Album, 0, len(groups))
	for _, group := range groups {
		album := c.mapReleaseGroup(group)
		discography = append(discography, album)
		if strings.EqualFold(group.PrimaryType, "Album") && !isLiveOrBootleg(group) {
			albums = append(albums, album)
		}
	}
	sort.SliceStable(albums, func(i, j int) bool {
		return albumSortKey(albums[i]) > albumSortKey(albums[j])
	})
	sort.SliceStable(discography, func(i, j int) bool {
		return albumSortKey(discography[i]) > albumSortKey(discography[j])
	})

	topTracks := c.fetchTopTracks(ctx, artist)
	return &musiccatalog.ArtistDetails{
		Artist:      artist,
		TopTracks:   topTracks,
		Albums:      albums,
		Discography: discography,
	}, nil
}

func (c *Client) browseArtistReleaseGroups(ctx context.Context, artistID string, limit int) ([]mbReleaseGroup, error) {
	params := url.Values{}
	params.Set("artist", artistID)
	params.Set("limit", strconv.Itoa(limit))
	params.Set("offset", "0")
	params.Set("type", "album|ep|single")
	var payload releaseGroupBrowseResponse
	if err := c.getJSON(ctx, "/release-group", params, &payload); err != nil {
		return nil, err
	}
	return payload.ReleaseGroups, nil
}

func (c *Client) fetchTopTracks(ctx context.Context, artist musiccatalog.Artist) []musiccatalog.TopTrack {
	if c.enricher != nil && c.enricher.Configured() {
		tracks, err := c.enricher.ArtistTopTracks(ctx, artist.Name, 10)
		if err == nil && len(tracks) > 0 {
			out := make([]musiccatalog.TopTrack, 0, len(tracks))
			for _, track := range tracks {
				resolved := c.resolveTopTrack(ctx, artist, track)
				if resolved != nil {
					out = append(out, *resolved)
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}

	// Fallback: search popular-sounding recordings for the artist.
	query := artist.Name
	if !c.useLocalSearch() {
		query = fmt.Sprintf(`artist:"%s"`, luceneEscape(artist.Name))
	}
	tracks, err := c.searchRecordingsLocalOrRemote(ctx, query, 10)
	if err != nil {
		return nil
	}
	for i := range tracks {
		if len(tracks[i].ArtistIDs) == 0 {
			tracks[i].ArtistIDs = []string{artist.ID}
		}
		if len(tracks[i].Artists) == 0 {
			tracks[i].Artists = []string{artist.Name}
		}
	}
	return tracks
}

func (c *Client) resolveTopTrack(ctx context.Context, artist musiccatalog.Artist, hint musiccatalog.TopTrack) *musiccatalog.TopTrack {
	var tracks []musiccatalog.TopTrack
	var err error
	if c.useLocalSearch() {
		tracks, err = c.search.SearchRecordings(ctx, hint.Name+" "+artist.Name, 3)
	} else {
		query := fmt.Sprintf(`recording:"%s" AND artist:"%s"`, luceneEscape(hint.Name), luceneEscape(artist.Name))
		tracks, err = c.searchRecordings(ctx, query, 3)
	}
	if err != nil || len(tracks) == 0 {
		// Keep Last.fm hint with a synthetic-but-stable id when MB misses.
		if hint.ID == "" {
			hint.ID = "lfm:" + strings.ToLower(strings.ReplaceAll(artist.Name+"|"+hint.Name, " ", "-"))
		}
		if len(hint.Artists) == 0 {
			hint.Artists = []string{artist.Name}
		}
		if len(hint.ArtistIDs) == 0 {
			hint.ArtistIDs = []string{artist.ID}
		}
		if hint.ImageURL == "" {
			hint.ImageURL = artist.ImageURL
		}
		return &hint
	}
	best := tracks[0]
	if (best.ImageURL == "" || best.ImageURL == fallbackImage) && hint.ImageURL != "" {
		best.ImageURL = hint.ImageURL
	}
	if best.AlbumID != "" {
		best.ImageURL = c.coverURL(best.AlbumID)
	}
	if best.AlbumName == "" {
		best.AlbumName = hint.AlbumName
	}
	return &best
}

func albumSortKey(album musiccatalog.Album) string {
	if album.ReleaseDate != "" {
		return album.ReleaseDate
	}
	if album.Year != nil {
		return fmt.Sprintf("%04d", *album.Year)
	}
	return ""
}
