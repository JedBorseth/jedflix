package lastfm

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

// Enricher adapts Last.fm chart/info/search endpoints for the music catalog.
type Enricher struct {
	client *Client
}

func NewEnricher(client *Client) *Enricher {
	return &Enricher{client: client}
}

func (e *Enricher) Configured() bool {
	return e != nil && e.client != nil && e.client.Configured()
}

func (e *Enricher) ArtistImage(ctx context.Context, name string) (string, error) {
	if !e.Configured() {
		return "", ErrNotConfigured
	}
	info, err := e.client.GetArtistInfo(ctx, name)
	if err != nil {
		return "", err
	}
	return info.ImageURL, nil
}

func (e *Enricher) ArtistTopTracks(ctx context.Context, name string, limit int) ([]musiccatalog.TopTrack, error) {
	if !e.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := e.client.GetArtistTopTracks(ctx, name, limit)
	if err != nil {
		return nil, err
	}
	out := make([]musiccatalog.TopTrack, 0, len(raw))
	for _, item := range raw {
		out = append(out, musiccatalog.TopTrack{
			ID:         strings.TrimSpace(item.MBID),
			Name:       item.Name,
			Artists:    []string{name},
			AlbumName:  item.AlbumName,
			ImageURL:   item.ImageURL,
			DurationMs: item.DurationMs,
		})
	}
	return out, nil
}

func (e *Enricher) TagTopArtists(ctx context.Context, tag string, limit int) ([]musicbrainz.TagArtistHint, error) {
	if !e.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := e.client.GetTagTopArtists(ctx, tag, limit)
	if err != nil {
		return nil, err
	}
	out := make([]musicbrainz.TagArtistHint, 0, len(raw))
	for _, item := range raw {
		out = append(out, musicbrainz.TagArtistHint{
			Name:     item.Name,
			MBID:     item.MBID,
			ImageURL: item.ImageURL,
		})
	}
	return out, nil
}

func (e *Enricher) TagTopAlbums(ctx context.Context, tag string, limit int) ([]musicbrainz.TagAlbumHint, error) {
	if !e.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := e.client.GetTagTopAlbums(ctx, tag, limit)
	if err != nil {
		return nil, err
	}
	out := make([]musicbrainz.TagAlbumHint, 0, len(raw))
	for _, item := range raw {
		out = append(out, musicbrainz.TagAlbumHint{
			Name:       item.Name,
			Artist:     item.Artist,
			MBID:       item.MBID,
			ArtistMBID: item.ArtistMBID,
			ImageURL:   item.ImageURL,
		})
	}
	return out, nil
}

func (e *Enricher) TagTopTracks(ctx context.Context, tag string, limit int) ([]musiccatalog.TopTrack, error) {
	if !e.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := e.client.GetTagTopTracks(ctx, tag, limit)
	if err != nil {
		return nil, err
	}
	out := make([]musiccatalog.TopTrack, 0, len(raw))
	for _, item := range raw {
		artists := []string{}
		if item.Artist != "" {
			artists = []string{item.Artist}
		}
		artistIDs := []string{}
		if item.ArtistMBID != "" {
			artistIDs = []string{item.ArtistMBID}
		}
		out = append(out, musiccatalog.TopTrack{
			ID:        strings.TrimSpace(item.MBID),
			Name:      item.Name,
			Artists:   artists,
			ArtistIDs: artistIDs,
			ImageURL:  item.ImageURL,
		})
	}
	return out, nil
}

func (e *Enricher) SearchArtists(ctx context.Context, query string, limit int) ([]musicbrainz.TagArtistHint, error) {
	if !e.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := e.client.SearchArtists(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	out := make([]musicbrainz.TagArtistHint, 0, len(raw))
	for _, item := range raw {
		out = append(out, musicbrainz.TagArtistHint{
			Name:     item.Name,
			MBID:     item.MBID,
			ImageURL: item.ImageURL,
		})
	}
	return out, nil
}

func (e *Enricher) SearchAlbums(ctx context.Context, query string, limit int) ([]musicbrainz.TagAlbumHint, error) {
	if !e.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := e.client.SearchAlbums(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	out := make([]musicbrainz.TagAlbumHint, 0, len(raw))
	for _, item := range raw {
		out = append(out, musicbrainz.TagAlbumHint{
			Name:       item.Name,
			Artist:     item.Artist,
			MBID:       item.MBID,
			ArtistMBID: item.ArtistMBID,
			ImageURL:   item.ImageURL,
		})
	}
	return out, nil
}

func (e *Enricher) SearchTracks(ctx context.Context, query string, limit int) ([]musiccatalog.TopTrack, error) {
	if !e.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := e.client.SearchTracks(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	out := make([]musiccatalog.TopTrack, 0, len(raw))
	for _, item := range raw {
		id := strings.TrimSpace(item.MBID)
		if id == "" {
			continue
		}
		artists := []string{}
		if item.Artist != "" {
			artists = []string{item.Artist}
		}
		out = append(out, musiccatalog.TopTrack{
			ID:        id,
			Name:      item.Name,
			Artists:   artists,
			ArtistIDs: []string{strings.TrimSpace(item.ArtistMBID)},
			AlbumName: item.AlbumName,
			ImageURL:  item.ImageURL,
		})
	}
	return out, nil
}

type ArtistInfo struct {
	Name     string
	MBID     string
	ImageURL string
	Bio      string
}

type TopTrackHint struct {
	Name       string
	MBID       string
	AlbumName  string
	ImageURL   string
	DurationMs int
}

type TagArtist struct {
	Name     string
	MBID     string
	ImageURL string
}

type TagAlbum struct {
	Name       string
	Artist     string
	MBID       string
	ArtistMBID string
	ImageURL   string
}

type TagTrack struct {
	Name       string
	Artist     string
	MBID       string
	ArtistMBID string
	ImageURL   string
}

type SearchTrack struct {
	Name       string
	MBID       string
	Artist     string
	ArtistMBID string
	AlbumName  string
	ImageURL   string
}

func (c *Client) GetArtistInfo(ctx context.Context, artist string) (*ArtistInfo, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	artist = strings.TrimSpace(artist)
	if artist == "" {
		return nil, fmt.Errorf("%w: artist is required", ErrBadRequest)
	}
	cacheKey := fmt.Sprintf("artist-info:%s", strings.ToLower(artist))
	if cached, ok := c.getCache(cacheKey); ok {
		if info, ok := cached.(*ArtistInfo); ok {
			return info, nil
		}
	}

	params := url.Values{}
	params.Set("method", "artist.getInfo")
	params.Set("artist", artist)
	params.Set("autocorrect", "1")

	var payload artistInfoResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}
	name := strings.TrimSpace(payload.Artist.Name)
	if name == "" {
		return nil, ErrNotFound
	}
	info := &ArtistInfo{
		Name:     name,
		MBID:     strings.TrimSpace(payload.Artist.MBID),
		ImageURL: pickImage(payload.Artist.Image),
		Bio:      strings.TrimSpace(payload.Artist.Bio.Summary),
	}
	c.putCache(cacheKey, info)
	return info, nil
}

func (c *Client) GetArtistTopTracks(ctx context.Context, artist string, limit int) ([]TopTrackHint, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	artist = strings.TrimSpace(artist)
	if artist == "" {
		return nil, fmt.Errorf("%w: artist is required", ErrBadRequest)
	}
	limit = clampLimit(limit)
	cacheKey := fmt.Sprintf("artist-top-tracks:%s:%d", strings.ToLower(artist), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if tracks, ok := cached.([]TopTrackHint); ok {
			return tracks, nil
		}
	}

	params := url.Values{}
	params.Set("method", "artist.getTopTracks")
	params.Set("artist", artist)
	params.Set("limit", strconv.Itoa(limit))
	params.Set("autocorrect", "1")

	var payload topTracksResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	out := make([]TopTrackHint, 0, len(payload.TopTracks.Track))
	for _, item := range payload.TopTracks.Track {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		durationMs := 0
		if d := strings.TrimSpace(item.Duration); d != "" {
			if sec, err := strconv.Atoi(d); err == nil && sec > 0 {
				durationMs = sec * 1000
			}
		}
		out = append(out, TopTrackHint{
			Name:       name,
			MBID:       strings.TrimSpace(item.MBID),
			ImageURL:   pickImage(item.Image),
			DurationMs: durationMs,
		})
	}
	c.putCache(cacheKey, out)
	return out, nil
}

func (c *Client) GetTagTopArtists(ctx context.Context, tag string, limit int) ([]TagArtist, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return nil, fmt.Errorf("%w: tag is required", ErrBadRequest)
	}
	limit = clampLimit(limit)
	cacheKey := fmt.Sprintf("tag-top-artists-rich:%s:%d", strings.ToLower(tag), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if artists, ok := cached.([]TagArtist); ok {
			return artists, nil
		}
	}

	params := url.Values{}
	params.Set("method", "tag.getTopArtists")
	params.Set("tag", tag)
	params.Set("limit", strconv.Itoa(limit))

	var payload tagTopArtistsResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	out := make([]TagArtist, 0, len(payload.TopArtists.Artist))
	for _, item := range payload.TopArtists.Artist {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		out = append(out, TagArtist{
			Name:     name,
			MBID:     strings.TrimSpace(item.MBID),
			ImageURL: pickImage(item.Image),
		})
	}
	c.putCache(cacheKey, out)
	return out, nil
}

func (c *Client) GetTagTopAlbums(ctx context.Context, tag string, limit int) ([]TagAlbum, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return nil, fmt.Errorf("%w: tag is required", ErrBadRequest)
	}
	limit = clampLimit(limit)
	cacheKey := fmt.Sprintf("tag-top-albums-rich:%s:%d", strings.ToLower(tag), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if albums, ok := cached.([]TagAlbum); ok {
			return albums, nil
		}
	}

	params := url.Values{}
	params.Set("method", "tag.getTopAlbums")
	params.Set("tag", tag)
	params.Set("limit", strconv.Itoa(limit))

	var payload tagTopAlbumsResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	albums := payload.albums()
	out := make([]TagAlbum, 0, len(albums))
	for _, item := range albums {
		name := strings.TrimSpace(item.Name)
		artist := strings.TrimSpace(item.Artist.Name)
		if name == "" || artist == "" {
			continue
		}
		out = append(out, TagAlbum{
			Name:       name,
			Artist:     artist,
			MBID:       strings.TrimSpace(item.MBID),
			ArtistMBID: strings.TrimSpace(item.Artist.MBID),
			ImageURL:   pickImage(item.Image),
		})
	}
	c.putCache(cacheKey, out)
	return out, nil
}

func (c *Client) GetTagTopTracks(ctx context.Context, tag string, limit int) ([]TagTrack, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return nil, fmt.Errorf("%w: tag is required", ErrBadRequest)
	}
	limit = clampLimit(limit)
	cacheKey := fmt.Sprintf("tag-top-tracks-rich:%s:%d", strings.ToLower(tag), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if tracks, ok := cached.([]TagTrack); ok {
			return tracks, nil
		}
	}

	params := url.Values{}
	params.Set("method", "tag.getTopTracks")
	params.Set("tag", tag)
	params.Set("limit", strconv.Itoa(limit))

	var payload tagTopTracksResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	out := make([]TagTrack, 0, len(payload.TopTracks.Track))
	for _, item := range payload.TopTracks.Track {
		name := strings.TrimSpace(item.Name)
		artist := strings.TrimSpace(item.Artist.Name)
		if name == "" || artist == "" {
			continue
		}
		out = append(out, TagTrack{
			Name:       name,
			Artist:     artist,
			MBID:       strings.TrimSpace(item.MBID),
			ArtistMBID: strings.TrimSpace(item.Artist.MBID),
			ImageURL:   pickImage(item.Image),
		})
	}
	c.putCache(cacheKey, out)
	return out, nil
}

func (c *Client) SearchArtists(ctx context.Context, query string, limit int) ([]TagArtist, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: query is required", ErrBadRequest)
	}
	limit = clampLimit(limit)
	cacheKey := fmt.Sprintf("search-artists:%s:%d", strings.ToLower(query), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if artists, ok := cached.([]TagArtist); ok {
			return artists, nil
		}
	}

	params := url.Values{}
	params.Set("method", "artist.search")
	params.Set("artist", query)
	params.Set("limit", strconv.Itoa(limit))

	var payload artistSearchResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	out := make([]TagArtist, 0, len(payload.Results.ArtistMatches.Artist))
	for _, item := range payload.Results.ArtistMatches.Artist {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		out = append(out, TagArtist{
			Name:     name,
			MBID:     strings.TrimSpace(item.MBID),
			ImageURL: pickImage(item.Image),
		})
	}
	c.putCache(cacheKey, out)
	return out, nil
}

func (c *Client) SearchAlbums(ctx context.Context, query string, limit int) ([]TagAlbum, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: query is required", ErrBadRequest)
	}
	limit = clampLimit(limit)
	cacheKey := fmt.Sprintf("search-albums:%s:%d", strings.ToLower(query), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if albums, ok := cached.([]TagAlbum); ok {
			return albums, nil
		}
	}

	params := url.Values{}
	params.Set("method", "album.search")
	params.Set("album", query)
	params.Set("limit", strconv.Itoa(limit))

	var payload albumSearchResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	out := make([]TagAlbum, 0, len(payload.Results.AlbumMatches.Album))
	for _, item := range payload.Results.AlbumMatches.Album {
		name := strings.TrimSpace(item.Name)
		artist := strings.TrimSpace(item.Artist)
		if name == "" {
			continue
		}
		out = append(out, TagAlbum{
			Name:     name,
			Artist:   artist,
			MBID:     strings.TrimSpace(item.MBID),
			ImageURL: pickImage(item.Image),
		})
	}
	c.putCache(cacheKey, out)
	return out, nil
}

func (c *Client) SearchTracks(ctx context.Context, query string, limit int) ([]SearchTrack, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: query is required", ErrBadRequest)
	}
	limit = clampLimit(limit)
	cacheKey := fmt.Sprintf("search-tracks:%s:%d", strings.ToLower(query), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if tracks, ok := cached.([]SearchTrack); ok {
			return tracks, nil
		}
	}

	params := url.Values{}
	params.Set("method", "track.search")
	params.Set("track", query)
	params.Set("limit", strconv.Itoa(limit))

	var payload trackSearchResponse
	if err := c.getJSON(ctx, params, &payload); err != nil {
		return nil, err
	}
	if payload.Error != 0 {
		return nil, mapAPIError(payload.Error, payload.Message)
	}

	out := make([]SearchTrack, 0, len(payload.Results.TrackMatches.Track))
	for _, item := range payload.Results.TrackMatches.Track {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		out = append(out, SearchTrack{
			Name:     name,
			MBID:     strings.TrimSpace(item.MBID),
			Artist:   strings.TrimSpace(item.Artist),
			ImageURL: pickImage(item.Image),
		})
	}
	c.putCache(cacheKey, out)
	return out, nil
}

type artistInfoResponse struct {
	Error   int    `json:"error"`
	Message string `json:"message"`
	Artist  struct {
		Name  string     `json:"name"`
		MBID  string     `json:"mbid"`
		Image []lfmImage `json:"image"`
		Bio   struct {
			Summary string `json:"summary"`
		} `json:"bio"`
	} `json:"artist"`
}

type topTracksResponse struct {
	Error     int    `json:"error"`
	Message   string `json:"message"`
	TopTracks struct {
		Track []struct {
			Name     string     `json:"name"`
			MBID     string     `json:"mbid"`
			Duration string     `json:"duration"`
			Image    []lfmImage `json:"image"`
		} `json:"track"`
	} `json:"toptracks"`
}

type tagTopArtistsResponse struct {
	Error      int    `json:"error"`
	Message    string `json:"message"`
	TopArtists struct {
		Artist []struct {
			Name  string     `json:"name"`
			MBID  string     `json:"mbid"`
			Image []lfmImage `json:"image"`
		} `json:"artist"`
	} `json:"topartists"`
}

type tagAlbumItem struct {
	Name   string `json:"name"`
	MBID   string `json:"mbid"`
	Artist struct {
		Name string `json:"name"`
		MBID string `json:"mbid"`
	} `json:"artist"`
	Image []lfmImage `json:"image"`
}

type tagAlbumList struct {
	Album []tagAlbumItem `json:"album"`
}

// Last.fm JSON uses "albums" here; official XML/docs say "topalbums".
type tagTopAlbumsResponse struct {
	Error     int          `json:"error"`
	Message   string       `json:"message"`
	Albums    tagAlbumList `json:"albums"`
	TopAlbums tagAlbumList `json:"topalbums"`
}

func (p tagTopAlbumsResponse) albums() []tagAlbumItem {
	if len(p.Albums.Album) > 0 {
		return p.Albums.Album
	}
	return p.TopAlbums.Album
}

type tagTopTracksResponse struct {
	Error     int    `json:"error"`
	Message   string `json:"message"`
	TopTracks struct {
		Track []struct {
			Name   string `json:"name"`
			MBID   string `json:"mbid"`
			Artist struct {
				Name string `json:"name"`
				MBID string `json:"mbid"`
			} `json:"artist"`
			Image []lfmImage `json:"image"`
		} `json:"track"`
	} `json:"tracks"`
}

type artistSearchResponse struct {
	Error   int    `json:"error"`
	Message string `json:"message"`
	Results struct {
		ArtistMatches struct {
			Artist []struct {
				Name  string     `json:"name"`
				MBID  string     `json:"mbid"`
				Image []lfmImage `json:"image"`
			} `json:"artist"`
		} `json:"artistmatches"`
	} `json:"results"`
}

type albumSearchResponse struct {
	Error   int    `json:"error"`
	Message string `json:"message"`
	Results struct {
		AlbumMatches struct {
			Album []struct {
				Name   string     `json:"name"`
				Artist string     `json:"artist"`
				MBID   string     `json:"mbid"`
				Image  []lfmImage `json:"image"`
			} `json:"album"`
		} `json:"albummatches"`
	} `json:"results"`
}

type trackSearchResponse struct {
	Error   int    `json:"error"`
	Message string `json:"message"`
	Results struct {
		TrackMatches struct {
			Track []struct {
				Name   string     `json:"name"`
				Artist string     `json:"artist"`
				MBID   string     `json:"mbid"`
				Image  []lfmImage `json:"image"`
			} `json:"track"`
		} `json:"trackmatches"`
	} `json:"results"`
}
