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

// Enricher adapts Last.fm chart/info endpoints for the MusicBrainz catalog.
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
			ID:        strings.TrimSpace(item.MBID),
			Name:      item.Name,
			Artists:   []string{name},
			AlbumName: item.AlbumName,
			ImageURL:  item.ImageURL,
			DurationMs: item.DurationMs,
		})
	}
	return out, nil
}

func (e *Enricher) TagTopArtists(ctx context.Context, tag string, limit int) ([]string, error) {
	if !e.Configured() {
		return nil, ErrNotConfigured
	}
	return e.client.GetTagTopArtists(ctx, tag, limit)
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
		out = append(out, musicbrainz.TagAlbumHint{Name: item.Name, Artist: item.Artist})
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

type TagAlbum struct {
	Name   string
	Artist string
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

func (c *Client) GetTagTopArtists(ctx context.Context, tag string, limit int) ([]string, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return nil, fmt.Errorf("%w: tag is required", ErrBadRequest)
	}
	limit = clampLimit(limit)
	cacheKey := fmt.Sprintf("tag-top-artists:%s:%d", strings.ToLower(tag), limit)
	if cached, ok := c.getCache(cacheKey); ok {
		if names, ok := cached.([]string); ok {
			return names, nil
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

	out := make([]string, 0, len(payload.TopArtists.Artist))
	for _, item := range payload.TopArtists.Artist {
		name := strings.TrimSpace(item.Name)
		if name != "" {
			out = append(out, name)
		}
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
	cacheKey := fmt.Sprintf("tag-top-albums:%s:%d", strings.ToLower(tag), limit)
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

	out := make([]TagAlbum, 0, len(payload.TopAlbums.Album))
	for _, item := range payload.TopAlbums.Album {
		name := strings.TrimSpace(item.Name)
		artist := strings.TrimSpace(item.Artist.Name)
		if name == "" || artist == "" {
			continue
		}
		out = append(out, TagAlbum{Name: name, Artist: artist})
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
			Name string `json:"name"`
			MBID string `json:"mbid"`
		} `json:"artist"`
	} `json:"topartists"`
}

type tagTopAlbumsResponse struct {
	Error     int    `json:"error"`
	Message   string `json:"message"`
	TopAlbums struct {
		Album []struct {
			Name   string `json:"name"`
			Artist struct {
				Name string `json:"name"`
			} `json:"artist"`
		} `json:"album"`
	} `json:"topalbums"`
}
