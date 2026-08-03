package spotify

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

const (
	genreArtistLimit       = 20
	genreReleaseLimit      = 20
	releasesPerArtist      = 4
	releaseArtistScanLimit = 10 // how many top artists to pull albums/singles from
	newReleasesQuery       = "tag:new"
	newReleasesKey         = "new-releases"
)

type relatedArtistsPayload struct {
	Artists []spotifyArtistPayload `json:"artists"`
}

// fetchGenreRows expands seed artists via Related Artists and builds
// Popular Artists / Popular Albums / Popular Singles shelves for one genre.
func (c *Client) fetchGenreRows(ctx context.Context, genre GenreConfig) ([]CatalogRow, error) {
	artists, err := c.expandGenreArtists(ctx, genre)
	if err != nil {
		return nil, err
	}
	if len(artists) == 0 {
		return nil, fmt.Errorf("%w: no artists for genre %s", ErrFetchFailed, genre.Key)
	}

	rows := make([]CatalogRow, 0, 3)
	rows = append(rows, CatalogRow{
		Title:   "Popular " + genre.Title + " Artists",
		Key:     genre.Key + "-artists",
		Kind:    "artists",
		Artists: artists,
	})

	albums := c.collectArtistReleases(ctx, artists, "album", genreReleaseLimit)
	if len(albums) > 0 {
		rows = append(rows, CatalogRow{
			Title:  "Popular " + genre.Title + " Albums",
			Key:    genre.Key + "-albums",
			Kind:   "albums",
			Albums: albums,
		})
	}

	singles := c.collectArtistReleases(ctx, artists, "single", genreReleaseLimit)
	if len(singles) > 0 {
		rows = append(rows, CatalogRow{
			Title:  "Popular " + genre.Title + " Singles",
			Key:    genre.Key + "-singles",
			Kind:   "albums",
			Albums: singles,
		})
	}

	return rows, nil
}

// expandGenreArtists resolves seed names, fetches related artists, dedupes by ID,
// and returns artists sorted by popularity (descending).
func (c *Client) expandGenreArtists(ctx context.Context, genre GenreConfig) ([]Artist, error) {
	byID := make(map[string]Artist)
	for _, seedName := range genre.Seeds {
		seedName = strings.TrimSpace(seedName)
		if seedName == "" {
			continue
		}
		seed, err := c.resolveArtistByName(ctx, seedName)
		if err != nil || seed.ID == "" {
			continue
		}
		byID[seed.ID] = seed

		related, relErr := c.fetchRelatedArtists(ctx, seed.ID)
		if relErr != nil {
			// Related Artists is unavailable for many Dev Mode apps (403).
			// Seeds alone still produce a curated shelf.
			continue
		}
		for _, artist := range related {
			if artist.ID == "" {
				continue
			}
			if existing, ok := byID[artist.ID]; ok {
				// Keep the richer popularity/followers when duplicates appear.
				if artist.Popularity > existing.Popularity || artist.Followers > existing.Followers {
					byID[artist.ID] = artist
				}
				continue
			}
			byID[artist.ID] = artist
		}
	}

	if len(byID) == 0 {
		return nil, fmt.Errorf("%w: unable to resolve seed artists for %s", ErrFetchFailed, genre.Key)
	}

	artists := make([]Artist, 0, len(byID))
	for _, artist := range byID {
		artists = append(artists, artist)
	}
	sort.SliceStable(artists, func(i, j int) bool {
		if artists[i].Popularity != artists[j].Popularity {
			return artists[i].Popularity > artists[j].Popularity
		}
		if artists[i].Followers != artists[j].Followers {
			return artists[i].Followers > artists[j].Followers
		}
		return artists[i].Name < artists[j].Name
	})
	if len(artists) > genreArtistLimit {
		artists = artists[:genreArtistLimit]
	}
	return artists, nil
}

func (c *Client) resolveArtistByName(ctx context.Context, name string) (Artist, error) {
	params := url.Values{}
	params.Set("q", name)
	params.Set("type", "artist")
	params.Set("limit", strconv.Itoa(defaultLimit))

	var payload searchResponsePayload
	if err := c.getJSON(ctx, "/search?"+params.Encode(), &payload); err != nil {
		return Artist{}, err
	}
	if payload.Artists == nil || len(payload.Artists.Items) == 0 {
		return Artist{}, ErrNotFound
	}

	normalized := strings.EqualFold
	target := strings.TrimSpace(name)
	var best Artist
	bestScore := -1
	for _, item := range payload.Artists.Items {
		artist := mapArtist(item)
		if artist.ID == "" {
			continue
		}
		score := 0
		if normalized(artist.Name, target) {
			score = 1000 + artist.Popularity
		} else if strings.Contains(strings.ToLower(artist.Name), strings.ToLower(target)) ||
			strings.Contains(strings.ToLower(target), strings.ToLower(artist.Name)) {
			score = 500 + artist.Popularity
		} else {
			score = artist.Popularity
		}
		if score > bestScore {
			bestScore = score
			best = artist
		}
	}
	if best.ID == "" {
		return Artist{}, ErrNotFound
	}
	return best, nil
}

func (c *Client) fetchRelatedArtists(ctx context.Context, artistID string) ([]Artist, error) {
	artistID = NormalizeID(artistID)
	if artistID == "" {
		return nil, fmt.Errorf("%w: invalid artist id", ErrBadRequest)
	}

	var payload relatedArtistsPayload
	if err := c.getJSON(ctx, "/artists/"+url.PathEscape(artistID)+"/related-artists", &payload); err != nil {
		return nil, err
	}

	artists := make([]Artist, 0, len(payload.Artists))
	seen := make(map[string]struct{})
	for _, item := range payload.Artists {
		artist := mapArtist(item)
		if artist.ID == "" {
			continue
		}
		if _, ok := seen[artist.ID]; ok {
			continue
		}
		seen[artist.ID] = struct{}{}
		artists = append(artists, artist)
	}
	return artists, nil
}

// collectArtistReleases walks the most popular artists and gathers albums or singles.
func (c *Client) collectArtistReleases(ctx context.Context, artists []Artist, includeGroup string, maxItems int) []Album {
	if maxItems <= 0 {
		maxItems = genreReleaseLimit
	}
	seen := make(map[string]struct{})
	releases := make([]Album, 0, maxItems)

	scanLimit := releaseArtistScanLimit
	if scanLimit > len(artists) {
		scanLimit = len(artists)
	}

	for _, artist := range artists[:scanLimit] {
		if len(releases) >= maxItems {
			break
		}
		items, err := c.fetchArtistAlbums(ctx, artist.ID, releasesPerArtist, includeGroup)
		if err != nil {
			continue
		}
		for _, album := range items {
			if album.ID == "" {
				continue
			}
			if _, ok := seen[album.ID]; ok {
				continue
			}
			seen[album.ID] = struct{}{}
			releases = append(releases, album)
			if len(releases) >= maxItems {
				break
			}
		}
	}

	sort.SliceStable(releases, func(i, j int) bool {
		if releases[i].Popularity != releases[j].Popularity {
			return releases[i].Popularity > releases[j].Popularity
		}
		// Prefer newer releases when popularity is missing (simplified album objects).
		return releases[i].ReleaseDate > releases[j].ReleaseDate
	})
	if len(releases) > maxItems {
		releases = releases[:maxItems]
	}
	return releases
}

func (c *Client) fetchNewReleasesRow(ctx context.Context) (CatalogRow, error) {
	albums, err := c.searchAlbums(ctx, newReleasesQuery, catalogPageCount*defaultLimit)
	if err != nil {
		return CatalogRow{}, err
	}
	if len(albums) == 0 {
		return CatalogRow{}, fmt.Errorf("%w: empty new releases", ErrFetchFailed)
	}
	return CatalogRow{
		Title:  "New Releases",
		Key:    newReleasesKey,
		Kind:   "albums",
		Albums: albums,
	}, nil
}
