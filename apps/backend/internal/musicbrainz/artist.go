package musicbrainz

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

const (
	lastFMTopTracksTimeout     = 2500 * time.Millisecond
	topTrackResolveConcurrency = 6
)

func (c *Client) fetchArtistDetails(ctx context.Context, artistID string) (*musiccatalog.ArtistDetails, error) {
	params := url.Values{}
	params.Set("inc", "tags")
	var payload mbArtist
	if err := c.getJSON(ctx, "/artist/"+artistID, params, &payload); err != nil {
		return nil, err
	}
	artist := mapArtist(payload)
	artist.ImageURL = c.artistCoverURL(artist.ID)

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
	if c.useLocalStore() && artist.ID != "" {
		localCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
		tracks, err := c.local.ListArtistTopTracks(localCtx, artist.ID, 10)
		cancel()
		if err == nil && len(tracks) > 0 {
			out := make([]musiccatalog.TopTrack, 0, len(tracks))
			for i := range tracks {
				out = append(out, *c.finalizeTopTrack(artist, &tracks[i]))
			}
			return out
		}
	}

	var hints []musiccatalog.TopTrack
	if c.enricher != nil && c.enricher.Configured() {
		lfmCtx, cancel := context.WithTimeout(ctx, lastFMTopTracksTimeout)
		tracks, err := c.enricher.ArtistTopTracks(lfmCtx, artist.Name, 10)
		cancel()
		if err == nil && len(tracks) > 0 {
			hints = tracks
		}
	}

	if len(hints) == 0 {
		query := artist.Name
		if !c.useLocalStore() {
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
			tracks[i] = *c.finalizeTopTrack(artist, &tracks[i])
		}
		return tracks
	}

	return c.resolveTopTrackHints(ctx, artist, hints)
}

func (c *Client) resolveTopTrackHints(ctx context.Context, artist musiccatalog.Artist, hints []musiccatalog.TopTrack) []musiccatalog.TopTrack {
	out := make([]musiccatalog.TopTrack, len(hints))
	var wg sync.WaitGroup
	sem := make(chan struct{}, topTrackResolveConcurrency)
	for i, hint := range hints {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, hint musiccatalog.TopTrack) {
			defer wg.Done()
			defer func() { <-sem }()
			if resolved := c.resolveTopTrack(ctx, artist, hint); resolved != nil {
				out[i] = *resolved
			}
		}(i, hint)
	}
	wg.Wait()

	compact := make([]musiccatalog.TopTrack, 0, len(out))
	seen := map[string]struct{}{}
	for _, track := range out {
		if track.ID == "" || track.Name == "" {
			continue
		}
		if _, ok := seen[track.ID]; ok {
			continue
		}
		seen[track.ID] = struct{}{}
		compact = append(compact, track)
	}
	return compact
}

func (c *Client) resolveTopTrack(ctx context.Context, artist musiccatalog.Artist, hint musiccatalog.TopTrack) *musiccatalog.TopTrack {
	applyHint := func(resolved *musiccatalog.TopTrack) *musiccatalog.TopTrack {
		if resolved == nil {
			return nil
		}
		if resolved.DurationMs <= 0 && hint.DurationMs > 0 {
			resolved.DurationMs = hint.DurationMs
		}
		if resolved.AlbumName == "" {
			resolved.AlbumName = hint.AlbumName
		}
		return c.finalizeTopTrack(artist, resolved)
	}

	if c.useLocalStore() {
		if id := NormalizeMBID(hint.ID); id != "" {
			if rec, err := c.local.GetRecording(ctx, id); err == nil && rec != nil {
				return applyHint(rec)
			}
		}
	}

	if c.useLocalStore() {
		if rec, err := c.local.ResolveRecordingForArtist(ctx, artist.ID, hint.Name); err == nil && rec != nil {
			return applyHint(rec)
		}
	}

	if hint.ID == "" {
		hint.ID = "lfm:" + strings.ToLower(strings.ReplaceAll(artist.Name+"|"+hint.Name, " ", "-"))
	}
	if len(hint.Artists) == 0 {
		hint.Artists = []string{artist.Name}
	}
	if len(hint.ArtistIDs) == 0 {
		hint.ArtistIDs = []string{artist.ID}
	}
	return c.finalizeTopTrack(artist, &hint)
}

func pickResolvedTrack(hint musiccatalog.TopTrack, candidates []musiccatalog.TopTrack) *musiccatalog.TopTrack {
	target := strings.ToLower(strings.TrimSpace(hint.Name))
	if target == "" {
		return nil
	}
	var best *musiccatalog.TopTrack
	bestScore := -1
	for i := range candidates {
		candidate := &candidates[i]
		name := strings.ToLower(strings.TrimSpace(candidate.Name))
		score := 0
		switch {
		case name == target:
			score = 100
		case strings.HasPrefix(name, target) || strings.HasPrefix(target, name):
			score = 80
		case strings.Contains(name, target) || strings.Contains(target, name):
			score = 50
		default:
			continue
		}
		if candidate.AlbumID != "" {
			score += 10
		}
		if candidate.DurationMs > 0 {
			score += 5
		}
		if score > bestScore {
			bestScore = score
			best = candidate
		}
	}
	if best == nil || bestScore < 50 {
		return nil
	}
	copy := *best
	return &copy
}

func (c *Client) finalizeTopTrack(artist musiccatalog.Artist, track *musiccatalog.TopTrack) *musiccatalog.TopTrack {
	if track == nil {
		return nil
	}
	out := *track
	if len(out.ArtistIDs) == 0 {
		out.ArtistIDs = []string{artist.ID}
	}
	if len(out.Artists) == 0 {
		out.Artists = []string{artist.Name}
	}
	if out.AlbumID != "" {
		out.ImageURL = c.coverURL(out.AlbumID)
	} else {
		out.ImageURL = fallbackImage
	}
	return &out
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
