package musicbrainz

import (
	"context"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func (c *Client) fetchReleaseGroupAlbum(ctx context.Context, releaseGroupID string, withTracks bool) (*musiccatalog.Album, error) {
	params := url.Values{}
	params.Set("inc", "artists+tags")
	var group mbReleaseGroup
	if err := c.getJSON(ctx, "/release-group/"+releaseGroupID, params, &group); err != nil {
		return nil, err
	}
	album := c.mapReleaseGroup(group)
	if !withTracks {
		return &album, nil
	}

	releaseID, err := c.pickOfficialRelease(ctx, releaseGroupID)
	if err != nil {
		return &album, nil
	}
	detailed, err := c.fetchReleaseTracks(ctx, releaseID)
	if err != nil {
		return &album, nil
	}

	album.Tracks = detailed.Tracks
	album.TotalTracks = len(detailed.Tracks)
	if detailed.Label != "" {
		album.Label = detailed.Label
	}
	if detailed.ReleaseDate != "" {
		album.ReleaseDate = detailed.ReleaseDate
		album.Year = parseYear(detailed.ReleaseDate)
	}
	return &album, nil
}

func (c *Client) pickOfficialRelease(ctx context.Context, releaseGroupID string) (string, error) {
	params := url.Values{}
	params.Set("release-group", releaseGroupID)
	params.Set("status", "official")
	params.Set("limit", "25")
	var payload releaseBrowseResponse
	if err := c.getJSON(ctx, "/release", params, &payload); err != nil {
		return "", err
	}
	if len(payload.Releases) == 0 {
		// Retry without status filter.
		params.Del("status")
		if err := c.getJSON(ctx, "/release", params, &payload); err != nil {
			return "", err
		}
	}
	if len(payload.Releases) == 0 {
		return "", musiccatalog.ErrNotFound
	}

	releases := append([]mbRelease(nil), payload.Releases...)
	sort.SliceStable(releases, func(i, j int) bool {
		return releaseRank(releases[i]) > releaseRank(releases[j])
	})
	return releases[0].ID, nil
}

func releaseRank(rel mbRelease) int {
	score := 0
	if strings.EqualFold(rel.Status, "Official") {
		score += 100
	}
	switch strings.ToUpper(rel.Country) {
	case "XW", "XE", "US", "GB":
		score += 20
	}
	if rel.Date != "" {
		score += 5
		// Prefer earlier official editions slightly for canonical tracklists.
		score += 1000 - len(rel.Date) // YYYY < YYYY-MM-DD tie-break soft
	}
	return score
}

func (c *Client) fetchReleaseTracks(ctx context.Context, releaseID string) (*musiccatalog.Album, error) {
	params := url.Values{}
	params.Set("inc", "recordings+artist-credits+labels")
	var payload mbRelease
	if err := c.getJSON(ctx, "/release/"+releaseID, params, &payload); err != nil {
		return nil, err
	}

	artists, artistIDs := creditsToArtists(payload.ArtistCredit)
	tracks := make([]musiccatalog.Track, 0)
	for _, medium := range payload.Media {
		disc := medium.Position
		if disc <= 0 {
			disc = 1
		}
		for i, t := range medium.Tracks {
			name := t.Title
			id := t.Recording.ID
			if name == "" {
				name = t.Recording.Title
			}
			if id == "" {
				id = t.ID
			}
			duration := t.Length
			if duration <= 0 {
				duration = t.Recording.Length
			}
			trackArtists, trackArtistIDs := creditsToArtists(t.ArtistCredit)
			if len(trackArtists) == 0 {
				trackArtists = artists
				trackArtistIDs = artistIDs
			}
			num := i + 1
			if parsed, err := strconv.Atoi(strings.TrimSpace(t.Number)); err == nil && parsed > 0 {
				num = parsed
			}
			tracks = append(tracks, musiccatalog.Track{
				ID:          id,
				Name:        name,
				Artists:     trackArtists,
				ArtistIDs:   trackArtistIDs,
				TrackNumber: num,
				DiscNumber:  disc,
				DurationMs:  duration,
			})
		}
	}

	label := ""
	if len(payload.LabelInfo) > 0 {
		label = payload.LabelInfo[0].Label.Name
	}

	return &musiccatalog.Album{
		ID:          releaseID,
		Name:        payload.Title,
		Artists:     artists,
		ArtistIDs:   artistIDs,
		ReleaseDate: payload.Date,
		Year:        parseYear(payload.Date),
		Label:       label,
		Tracks:      tracks,
		TotalTracks: len(tracks),
		Genres:      []string{},
		ImageURL:    fallbackImage,
	}, nil
}
