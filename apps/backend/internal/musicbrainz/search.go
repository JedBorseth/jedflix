package musicbrainz

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/livematch"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

type mbArtistCredit struct {
	Name   string `json:"name"`
	Artist struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"artist"`
}

type mbTag struct {
	Count int    `json:"count"`
	Name  string `json:"name"`
}

type mbArtist struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Score int     `json:"score"`
	Tags  []mbTag `json:"tags"`
	Type  string  `json:"type"`
}

type mbReleaseGroup struct {
	ID             string           `json:"id"`
	Title          string           `json:"title"`
	Score          int              `json:"score"`
	PrimaryType    string           `json:"primary-type"`
	FirstRelease   string           `json:"first-release-date"`
	ArtistCredit   []mbArtistCredit `json:"artist-credit"`
	SecondaryTypes []string         `json:"secondary-types"`
	Tags           []mbTag          `json:"tags"`
}

type mbRecording struct {
	ID           string           `json:"id"`
	Title        string           `json:"title"`
	Score        int              `json:"score"`
	Length       int              `json:"length"` // ms
	ArtistCredit []mbArtistCredit `json:"artist-credit"`
	Releases     []struct {
		ID           string `json:"id"`
		Title        string `json:"title"`
		ReleaseGroup struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"release-group"`
	} `json:"releases"`
}

type mbRelease struct {
	ID           string           `json:"id"`
	Title        string           `json:"title"`
	Status       string           `json:"status"`
	Date         string           `json:"date"`
	Country      string           `json:"country"`
	ArtistCredit []mbArtistCredit `json:"artist-credit"`
	LabelInfo    []struct {
		Label struct {
			Name string `json:"name"`
		} `json:"label"`
	} `json:"label-info"`
	Media []struct {
		Position int `json:"position"`
		Tracks   []struct {
			ID        string `json:"id"`
			Number    string `json:"number"`
			Title     string `json:"title"`
			Length    int    `json:"length"`
			Recording struct {
				ID     string `json:"id"`
				Title  string `json:"title"`
				Length int    `json:"length"`
			} `json:"recording"`
			ArtistCredit []mbArtistCredit `json:"artist-credit"`
		} `json:"tracks"`
	} `json:"media"`
}

type artistSearchResponse struct {
	Artists []mbArtist `json:"artists"`
}

type releaseGroupSearchResponse struct {
	ReleaseGroups []mbReleaseGroup `json:"release-groups"`
}

type recordingSearchResponse struct {
	Recordings []mbRecording `json:"recordings"`
}

type releaseBrowseResponse struct {
	Releases     []mbRelease `json:"releases"`
	ReleaseCount int         `json:"release-count"`
}

type releaseGroupBrowseResponse struct {
	ReleaseGroups []mbReleaseGroup `json:"release-groups"`
	Count         int              `json:"release-group-count"`
}

func (c *Client) searchArtists(ctx context.Context, query string, limit int) ([]musiccatalog.Artist, error) {
	params := url.Values{}
	params.Set("query", query)
	params.Set("limit", fmt.Sprintf("%d", limit))
	var payload artistSearchResponse
	if err := c.getJSON(ctx, "/artist", params, &payload); err != nil {
		return nil, err
	}
	out := make([]musiccatalog.Artist, 0, len(payload.Artists))
	for _, item := range payload.Artists {
		artist := mapArtist(item)
		artist.ImageURL = c.artistCoverURL(artist.ID)
		out = append(out, artist)
	}
	return out, nil
}

func (c *Client) searchAlbums(ctx context.Context, query string, limit int) ([]musiccatalog.Album, error) {
	params := url.Values{}
	// Prefer studio albums over live/bootleg noise when the query is short.
	q := query
	if !strings.Contains(strings.ToLower(query), "primarytype:") {
		q = fmt.Sprintf(`(%s) AND (primarytype:Album OR primarytype:EP OR primarytype:Single)`, luceneEscape(query))
	}
	params.Set("query", q)
	params.Set("limit", fmt.Sprintf("%d", limit))
	var payload releaseGroupSearchResponse
	if err := c.getJSON(ctx, "/release-group", params, &payload); err != nil {
		return nil, err
	}
	out := make([]musiccatalog.Album, 0, len(payload.ReleaseGroups))
	for _, item := range payload.ReleaseGroups {
		if isLiveOrBootleg(item) {
			continue
		}
		out = append(out, c.mapReleaseGroup(item))
	}
	return out, nil
}

func (c *Client) searchRecordings(ctx context.Context, query string, limit int) ([]musiccatalog.TopTrack, error) {
	params := url.Values{}
	params.Set("query", query)
	params.Set("limit", fmt.Sprintf("%d", limit))
	var payload recordingSearchResponse
	if err := c.getJSON(ctx, "/recording", params, &payload); err != nil {
		return nil, err
	}
	out := make([]musiccatalog.TopTrack, 0, len(payload.Recordings))
	for _, item := range payload.Recordings {
		out = append(out, c.mapRecording(item))
	}
	return out, nil
}

func (c *Client) resolveArtistByName(ctx context.Context, name string) (*musiccatalog.Artist, error) {
	if c.useLocalStore() {
		artist, err := c.local.ResolveArtistByName(ctx, name)
		if err == nil && artist != nil {
			artist.ImageURL = c.artistCoverURL(artist.ID)
			return artist, nil
		}
		if err != nil && !errors.Is(err, musiccatalog.ErrNotFound) {
			return nil, err
		}
		artists, err := c.searchArtistsLocalOrRemote(ctx, name, 5)
		if err != nil {
			return nil, err
		}
		if len(artists) == 0 {
			return nil, musiccatalog.ErrNotFound
		}
		best := artists[0]
		for _, a := range artists {
			if strings.EqualFold(a.Name, name) {
				best = a
				break
			}
		}
		best.ImageURL = c.artistCoverURL(best.ID)
		return &best, nil
	}
	artists, err := c.searchArtists(ctx, `artist:"`+luceneEscape(name)+`"`, 5)
	if err != nil {
		return nil, err
	}
	if len(artists) == 0 {
		artists, err = c.searchArtists(ctx, name, 5)
		if err != nil {
			return nil, err
		}
	}
	if len(artists) == 0 {
		return nil, musiccatalog.ErrNotFound
	}
	best := artists[0]
	for _, a := range artists {
		if strings.EqualFold(a.Name, name) {
			best = a
			break
		}
	}
	best.ImageURL = c.artistCoverURL(best.ID)
	return &best, nil
}

func (c *Client) resolveAlbumByName(ctx context.Context, name, artist string) (*musiccatalog.Album, error) {
	if c.useLocalStore() {
		album, err := c.local.ResolveReleaseGroupByName(ctx, name, artist)
		if err == nil && album != nil {
			album.ImageURL = c.coverURL(album.ID)
			return album, nil
		}
		if err != nil && !errors.Is(err, musiccatalog.ErrNotFound) {
			return nil, err
		}
		q := name
		if artist != "" {
			q = name + " " + artist
		}
		albums, err := c.searchAlbumsLocalOrRemote(ctx, q, 5, "")
		if err != nil {
			return nil, err
		}
		if len(albums) == 0 {
			return nil, musiccatalog.ErrNotFound
		}
		album = &albums[0]
		detailed, err := c.local.GetReleaseGroupAlbum(ctx, album.ID, true)
		if err == nil && detailed != nil {
			detailed.ImageURL = c.coverURL(detailed.ID)
			return detailed, nil
		}
		album.ImageURL = c.coverURL(album.ID)
		return album, nil
	}
	query := `releasegroup:"` + luceneEscape(name) + `"`
	if artist != "" {
		query += ` AND artist:"` + luceneEscape(artist) + `"`
	}
	albums, err := c.searchAlbums(ctx, query, 5)
	if err != nil {
		return nil, err
	}
	if len(albums) == 0 {
		return nil, musiccatalog.ErrNotFound
	}
	album, err := c.fetchReleaseGroupAlbum(ctx, albums[0].ID, true)
	if err != nil {
		summary := albums[0]
		return &summary, nil
	}
	return album, nil
}

func mapArtist(item mbArtist) musiccatalog.Artist {
	genres := tagsToGenres(item.Tags, 5)
	return musiccatalog.Artist{
		ID:       item.ID,
		Name:     item.Name,
		ImageURL: fallbackImage,
		Genres:   genres,
		// Score maps loosely to a 0–100 popularity substitute.
		Popularity: clamp(item.Score, 0, 100),
	}
}

func (c *Client) mapReleaseGroup(item mbReleaseGroup) musiccatalog.Album {
	artists, artistIDs := creditsToArtists(item.ArtistCredit)
	date := item.FirstRelease
	return musiccatalog.Album{
		ID:          item.ID,
		Name:        item.Title,
		Artists:     artists,
		ArtistIDs:   artistIDs,
		ImageURL:    c.coverURL(item.ID),
		ReleaseDate: date,
		Year:        parseYear(date),
		AlbumType:   mapPrimaryType(item.PrimaryType),
		Genres:      tagsToGenres(item.Tags, 5),
		Popularity:  clamp(item.Score, 0, 100),
	}
}

func (c *Client) mapRecording(item mbRecording) musiccatalog.TopTrack {
	artists, artistIDs := creditsToArtists(item.ArtistCredit)
	albumID, albumName, imageURL := "", "", fallbackImage
	if len(item.Releases) > 0 {
		rel := item.Releases[0]
		albumName = rel.Title
		if rel.ReleaseGroup.ID != "" {
			albumID = rel.ReleaseGroup.ID
			if rel.ReleaseGroup.Title != "" {
				albumName = rel.ReleaseGroup.Title
			}
			imageURL = c.coverURL(albumID)
		}
	}
	return musiccatalog.TopTrack{
		ID:         item.ID,
		Name:       item.Title,
		Artists:    artists,
		ArtistIDs:  artistIDs,
		DurationMs: item.Length,
		AlbumID:    albumID,
		AlbumName:  albumName,
		ImageURL:   imageURL,
	}
}

func creditsToArtists(credits []mbArtistCredit) ([]string, []string) {
	names := make([]string, 0, len(credits))
	ids := make([]string, 0, len(credits))
	for _, credit := range credits {
		name := credit.Name
		if name == "" {
			name = credit.Artist.Name
		}
		if name == "" {
			continue
		}
		names = append(names, name)
		ids = append(ids, credit.Artist.ID)
	}
	return names, ids
}

func tagsToGenres(tags []mbTag, limit int) []string {
	if len(tags) == 0 {
		return []string{}
	}
	sorted := append([]mbTag(nil), tags...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].Count > sorted[j].Count
	})
	out := make([]string, 0, limit)
	seen := map[string]struct{}{}
	for _, tag := range sorted {
		name := strings.TrimSpace(tag.Name)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, name)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func isLiveOrBootleg(item mbReleaseGroup) bool {
	for _, t := range item.SecondaryTypes {
		switch strings.ToLower(t) {
		case "live", "bootleg", "interview", "audiobook":
			return true
		}
	}
	return livematch.LooksLikeLiveRecording(item.Title)
}

func luceneEscape(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`+`, `\+`,
		`-`, `\-`,
		`&&`, `\&&`,
		`||`, `\||`,
		`!`, `\!`,
		`(`, `\(`,
		`)`, `\)`,
		`{`, `\{`,
		`}`, `\}`,
		`[`, `\[`,
		`]`, `\]`,
		`^`, `\^`,
		`"`, `\"`,
		`~`, `\~`,
		`*`, `\*`,
		`?`, `\?`,
		`:`, `\:`,
	)
	return replacer.Replace(value)
}

func clamp(n, min, max int) int {
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}
