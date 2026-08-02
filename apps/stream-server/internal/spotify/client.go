package spotify

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
)

const (
	defaultAPIBaseURL = "https://api.spotify.com/v1"
	defaultAuthURL    = "https://accounts.spotify.com/api/token"
	fallbackImage     = "https://placehold.co/640x640/18181b/a1a1aa?text=No+Cover"
	// Development Mode caps GET /search (and several list endpoints) at limit=10.
	defaultLimit       = 10
	catalogPageCount   = 2 // 2 × 10 ≈ 20 items per shelf
	maxDetailCacheSize = 400
	maxArtistCacheSize = 200
	tokenRefreshSkew   = 60 * time.Second
)

var spotifyIDPattern = regexp.MustCompile(`^[a-zA-Z0-9]{22}$`)

type Client struct {
	apiBaseURL   string
	authURL      string
	clientID     string
	clientSecret string
	http         *http.Client
	refreshTTL   time.Duration
	rows         []RowConfig

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time

	catalogMu  sync.RWMutex
	catalog    *BrowseResponse
	refreshing bool
	refreshErr error

	albumCache  sync.Map // id -> cachedAlbum
	artistCache sync.Map // id -> cachedArtist
	now         func() time.Time
}

type cachedAlbum struct {
	album    Album
	cachedAt time.Time
}

type cachedArtist struct {
	artist   ArtistDetails
	cachedAt time.Time
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
}

type spotifyImage struct {
	URL    string `json:"url"`
	Height int    `json:"height"`
	Width  int    `json:"width"`
}

type spotifyArtistRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type spotifyTrackPayload struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	TrackNumber int                `json:"track_number"`
	DiscNumber  int                `json:"disc_number"`
	DurationMs  int                `json:"duration_ms"`
	Explicit    bool               `json:"explicit"`
	Artists     []spotifyArtistRef `json:"artists"`
}

type spotifyAlbumPayload struct {
	ID                   string             `json:"id"`
	Name                 string             `json:"name"`
	AlbumType            string             `json:"album_type"`
	TotalTracks          int                `json:"total_tracks"`
	ReleaseDate          string             `json:"release_date"`
	ReleaseDatePrecision string             `json:"release_date_precision"`
	Label                string             `json:"label"`
	Popularity           int                `json:"popularity"`
	Genres               []string           `json:"genres"`
	Images               []spotifyImage     `json:"images"`
	Artists              []spotifyArtistRef `json:"artists"`
	Tracks               *struct {
		Items []spotifyTrackPayload `json:"items"`
	} `json:"tracks"`
}

type spotifyArtistPayload struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Genres     []string       `json:"genres"`
	Popularity int            `json:"popularity"`
	Images     []spotifyImage `json:"images"`
	Followers  struct {
		Total int `json:"total"`
	} `json:"followers"`
}

type searchResponsePayload struct {
	Albums *struct {
		Items []spotifyAlbumPayload `json:"items"`
	} `json:"albums"`
	Artists *struct {
		Items []spotifyArtistPayload `json:"items"`
	} `json:"artists"`
}

type artistAlbumsResponse struct {
	Items []spotifyAlbumPayload `json:"items"`
}

func NewClient(cfg config.Config) *Client {
	httpClient := cfg.HTTPClient()
	httpClient.Timeout = 45 * time.Second

	apiBase := strings.TrimRight(cfg.SpotifyAPIBaseURL, "/")
	if apiBase == "" {
		apiBase = defaultAPIBaseURL
	}
	authURL := strings.TrimRight(cfg.SpotifyAuthURL, "/")
	if authURL == "" {
		authURL = defaultAuthURL
	}
	ttl := cfg.SpotifyCacheTTL
	if ttl <= 0 {
		ttl = 6 * time.Hour
	}

	return &Client{
		apiBaseURL:   apiBase,
		authURL:      authURL,
		clientID:     strings.TrimSpace(cfg.SpotifyClientID),
		clientSecret: strings.TrimSpace(cfg.SpotifyClientSecret),
		http:         httpClient,
		refreshTTL:   ttl,
		rows:         DefaultCatalogRows,
		now:          time.Now,
	}
}

func (c *Client) Configured() bool {
	return c.clientID != "" && c.clientSecret != ""
}

func (c *Client) Start(ctx context.Context) {
	if !c.Configured() {
		return
	}
	go c.refreshLoop(ctx)
}

func (c *Client) refreshLoop(ctx context.Context) {
	_ = c.Refresh(ctx)

	ticker := time.NewTicker(c.refreshTTL)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = c.Refresh(ctx)
		}
	}
}

func (c *Client) Refresh(ctx context.Context) error {
	if !c.Configured() {
		return ErrNotConfigured
	}

	c.catalogMu.Lock()
	if c.refreshing {
		c.catalogMu.Unlock()
		return nil
	}
	c.refreshing = true
	c.catalogMu.Unlock()

	defer func() {
		c.catalogMu.Lock()
		c.refreshing = false
		c.catalogMu.Unlock()
	}()

	rows := make([]CatalogRow, 0, len(c.rows))
	var newReleases []Album
	var lastErr error

	for _, row := range c.rows {
		catalogRow, rowErr := c.fetchCatalogRow(ctx, row)
		if rowErr != nil {
			lastErr = rowErr
			continue
		}
		if (catalogRow.Kind == "albums" && len(catalogRow.Albums) == 0) ||
			(catalogRow.Kind == "artists" && len(catalogRow.Artists) == 0) {
			continue
		}
		if row.Key == "new-releases" && catalogRow.Kind == "albums" {
			newReleases = catalogRow.Albums
		}
		rows = append(rows, catalogRow)
	}

	if len(rows) == 0 {
		err := lastErr
		if err == nil {
			err = fmt.Errorf("%w: empty catalog", ErrFetchFailed)
		}
		c.catalogMu.Lock()
		c.refreshErr = err
		c.catalogMu.Unlock()
		return err
	}

	response := &BrowseResponse{
		NewReleases: newReleases,
		Rows:        rows,
		CachedAt:    c.now().UnixMilli(),
	}

	c.catalogMu.Lock()
	c.catalog = response
	c.refreshErr = nil
	c.catalogMu.Unlock()
	return nil
}

func (c *Client) Browse(ctx context.Context) (*BrowseResponse, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}

	c.catalogMu.RLock()
	catalog := c.catalog
	refreshErr := c.refreshErr
	c.catalogMu.RUnlock()

	if catalog != nil {
		return catalog, nil
	}
	if refreshErr != nil {
		return nil, refreshErr
	}

	if err := c.Refresh(ctx); err != nil {
		return nil, err
	}

	c.catalogMu.RLock()
	defer c.catalogMu.RUnlock()
	if c.catalog == nil {
		return nil, fmt.Errorf("%w: empty catalog", ErrFetchFailed)
	}
	return c.catalog, nil
}

func (c *Client) Search(ctx context.Context, query string) (*SearchResponse, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: empty query", ErrBadRequest)
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("type", "album,artist")
	params.Set("limit", strconv.Itoa(defaultLimit))

	var payload searchResponsePayload
	if err := c.getJSON(ctx, "/search?"+params.Encode(), &payload); err != nil {
		return nil, err
	}

	result := &SearchResponse{
		Albums:  make([]Album, 0),
		Artists: make([]Artist, 0),
	}
	if payload.Albums != nil {
		for _, item := range payload.Albums.Items {
			if album := mapAlbum(item); album.ID != "" {
				result.Albums = append(result.Albums, album)
			}
		}
	}
	if payload.Artists != nil {
		for _, item := range payload.Artists.Items {
			if artist := mapArtist(item); artist.ID != "" {
				result.Artists = append(result.Artists, artist)
			}
		}
	}
	return result, nil
}

func (c *Client) GetAlbum(ctx context.Context, albumID string) (*Album, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	albumID = NormalizeID(albumID)
	if albumID == "" {
		return nil, fmt.Errorf("%w: invalid album id", ErrBadRequest)
	}

	if cached, ok := c.albumCache.Load(albumID); ok {
		entry := cached.(cachedAlbum)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL {
			album := entry.album
			return &album, nil
		}
	}

	var payload spotifyAlbumPayload
	if err := c.getJSON(ctx, "/albums/"+url.PathEscape(albumID), &payload); err != nil {
		return nil, err
	}
	album := mapAlbum(payload)
	if album.ID == "" {
		return nil, ErrNotFound
	}
	c.storeAlbum(album)
	return &album, nil
}

func (c *Client) GetArtist(ctx context.Context, artistID string) (*ArtistDetails, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	artistID = NormalizeID(artistID)
	if artistID == "" {
		return nil, fmt.Errorf("%w: invalid artist id", ErrBadRequest)
	}

	if cached, ok := c.artistCache.Load(artistID); ok {
		entry := cached.(cachedArtist)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL {
			artist := entry.artist
			return &artist, nil
		}
	}

	var payload spotifyArtistPayload
	if err := c.getJSON(ctx, "/artists/"+url.PathEscape(artistID), &payload); err != nil {
		return nil, err
	}
	artist := mapArtist(payload)
	if artist.ID == "" {
		return nil, ErrNotFound
	}

	albums, err := c.fetchArtistAlbums(ctx, artistID, defaultLimit)
	if err != nil {
		albums = nil
	}

	details := ArtistDetails{
		Artist: artist,
		Albums: albums,
	}
	c.storeArtist(details)
	return &details, nil
}

func NormalizeID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.Contains(value, ":") {
		parts := strings.Split(value, ":")
		value = parts[len(parts)-1]
	}
	if strings.Contains(value, "/") {
		parts := strings.Split(value, "/")
		value = parts[len(parts)-1]
	}
	value = strings.Split(value, "?")[0]
	if !spotifyIDPattern.MatchString(value) {
		return ""
	}
	return value
}

func (c *Client) fetchCatalogRow(ctx context.Context, row RowConfig) (CatalogRow, error) {
	if row.PlaylistID != "" {
		albums, err := c.fetchPlaylistAlbums(ctx, row.PlaylistID, catalogPageCount*defaultLimit)
		if err != nil {
			return CatalogRow{}, err
		}
		return CatalogRow{
			Title:  row.Title,
			Key:    row.Key,
			Kind:   "albums",
			Albums: albums,
		}, nil
	}
	switch row.Kind {
	case "artists":
		artists, err := c.searchArtists(ctx, row.Query, catalogPageCount*defaultLimit)
		if err != nil {
			return CatalogRow{}, err
		}
		return CatalogRow{
			Title:   row.Title,
			Key:     row.Key,
			Kind:    "artists",
			Artists: artists,
		}, nil
	default:
		albums, err := c.searchAlbums(ctx, row.Query, catalogPageCount*defaultLimit)
		if err != nil {
			return CatalogRow{}, err
		}
		return CatalogRow{
			Title:  row.Title,
			Key:    row.Key,
			Kind:   "albums",
			Albums: albums,
		}, nil
	}
}

type playlistTracksPayload struct {
	Items []struct {
		Track *struct {
			Album *spotifyAlbumPayload `json:"album"`
		} `json:"track"`
	} `json:"items"`
	Next string `json:"next"`
}

func (c *Client) fetchPlaylistAlbums(ctx context.Context, playlistID string, maxItems int) ([]Album, error) {
	playlistID = NormalizeID(playlistID)
	if playlistID == "" {
		return nil, fmt.Errorf("%w: invalid playlist id", ErrBadRequest)
	}
	if maxItems <= 0 {
		maxItems = catalogPageCount * defaultLimit
	}

	albums := make([]Album, 0, maxItems)
	seen := make(map[string]struct{})
	path := "/playlists/" + url.PathEscape(playlistID) + "/tracks?limit=50&fields=items(track(album(id,name,album_type,total_tracks,release_date,images,artists))),next"

	for path != "" && len(albums) < maxItems {
		var payload playlistTracksPayload
		if err := c.getJSON(ctx, path, &payload); err != nil {
			if len(albums) > 0 {
				return albums, nil
			}
			return nil, err
		}
		for _, item := range payload.Items {
			if item.Track == nil || item.Track.Album == nil {
				continue
			}
			album := mapAlbum(*item.Track.Album)
			if album.ID == "" {
				continue
			}
			if _, ok := seen[album.ID]; ok {
				continue
			}
			seen[album.ID] = struct{}{}
			albums = append(albums, album)
			if len(albums) >= maxItems {
				break
			}
		}
		next := strings.TrimSpace(payload.Next)
		if next == "" {
			break
		}
		// getJSON expects a path relative to apiBaseURL; strip the host if present.
		if strings.HasPrefix(next, c.apiBaseURL) {
			path = strings.TrimPrefix(next, c.apiBaseURL)
		} else if u, err := url.Parse(next); err == nil && u.Path != "" {
			path = u.Path
			if u.RawQuery != "" {
				path += "?" + u.RawQuery
			}
		} else {
			break
		}
	}
	return albums, nil
}

func (c *Client) searchAlbums(ctx context.Context, query string, maxItems int) ([]Album, error) {
	albums := make([]Album, 0, maxItems)
	seen := make(map[string]struct{})
	for offset := 0; len(albums) < maxItems && offset < maxItems; offset += defaultLimit {
		params := url.Values{}
		params.Set("q", query)
		params.Set("type", "album")
		params.Set("limit", strconv.Itoa(defaultLimit))
		params.Set("offset", strconv.Itoa(offset))

		var payload searchResponsePayload
		if err := c.getJSON(ctx, "/search?"+params.Encode(), &payload); err != nil {
			if len(albums) > 0 {
				return albums, nil
			}
			return nil, err
		}
		if payload.Albums == nil || len(payload.Albums.Items) == 0 {
			break
		}
		for _, item := range payload.Albums.Items {
			album := mapAlbum(item)
			if album.ID == "" {
				continue
			}
			if _, ok := seen[album.ID]; ok {
				continue
			}
			seen[album.ID] = struct{}{}
			albums = append(albums, album)
			if len(albums) >= maxItems {
				break
			}
		}
		if len(payload.Albums.Items) < defaultLimit {
			break
		}
	}
	return albums, nil
}

func (c *Client) searchArtists(ctx context.Context, query string, maxItems int) ([]Artist, error) {
	artists := make([]Artist, 0, maxItems)
	seen := make(map[string]struct{})
	for offset := 0; len(artists) < maxItems && offset < maxItems; offset += defaultLimit {
		params := url.Values{}
		params.Set("q", query)
		params.Set("type", "artist")
		params.Set("limit", strconv.Itoa(defaultLimit))
		params.Set("offset", strconv.Itoa(offset))

		var payload searchResponsePayload
		if err := c.getJSON(ctx, "/search?"+params.Encode(), &payload); err != nil {
			if len(artists) > 0 {
				return artists, nil
			}
			return nil, err
		}
		if payload.Artists == nil || len(payload.Artists.Items) == 0 {
			break
		}
		for _, item := range payload.Artists.Items {
			artist := mapArtist(item)
			if artist.ID == "" {
				continue
			}
			if _, ok := seen[artist.ID]; ok {
				continue
			}
			seen[artist.ID] = struct{}{}
			artists = append(artists, artist)
			if len(artists) >= maxItems {
				break
			}
		}
		if len(payload.Artists.Items) < defaultLimit {
			break
		}
	}
	return artists, nil
}

func (c *Client) fetchArtistAlbums(ctx context.Context, artistID string, limit int) ([]Album, error) {
	if limit <= 0 || limit > defaultLimit {
		limit = defaultLimit
	}
	params := url.Values{}
	params.Set("include_groups", "album,single")
	params.Set("limit", strconv.Itoa(limit))
	var payload artistAlbumsResponse
	if err := c.getJSON(ctx, "/artists/"+url.PathEscape(artistID)+"/albums?"+params.Encode(), &payload); err != nil {
		return nil, err
	}
	seen := make(map[string]struct{})
	albums := make([]Album, 0, len(payload.Items))
	for _, item := range payload.Items {
		album := mapAlbum(item)
		if album.ID == "" {
			continue
		}
		if _, ok := seen[album.ID]; ok {
			continue
		}
		seen[album.ID] = struct{}{}
		albums = append(albums, album)
	}
	return albums, nil
}

func (c *Client) getJSON(ctx context.Context, path string, dest any) error {
	token, err := c.getAccessToken(ctx)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiBaseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("%w: read body: %v", ErrFetchFailed, err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		if err := json.Unmarshal(body, dest); err != nil {
			return fmt.Errorf("%w: decode: %v", ErrFetchFailed, err)
		}
		return nil
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusBadRequest:
		return fmt.Errorf("%w: %s", ErrBadRequest, strings.TrimSpace(string(body)))
	case http.StatusUnauthorized:
		// Force token refresh on next call.
		c.mu.Lock()
		c.accessToken = ""
		c.tokenExpiry = time.Time{}
		c.mu.Unlock()
		return fmt.Errorf("%w: unauthorized", ErrFetchFailed)
	default:
		return fmt.Errorf("%w: status %d: %s", ErrFetchFailed, resp.StatusCode, strings.TrimSpace(string(body)))
	}
}

func (c *Client) getAccessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.accessToken != "" && c.now().Before(c.tokenExpiry.Add(-tokenRefreshSkew)) {
		return c.accessToken, nil
	}

	form := url.Values{}
	form.Set("grant_type", "client_credentials")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.authURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(c.clientID+":"+c.clientSecret)))

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: token request: %v", ErrFetchFailed, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("%w: token body: %v", ErrFetchFailed, err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: token status %d: %s", ErrFetchFailed, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var token tokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return "", fmt.Errorf("%w: token decode: %v", ErrFetchFailed, err)
	}
	if token.AccessToken == "" {
		return "", fmt.Errorf("%w: empty access token", ErrFetchFailed)
	}

	expiresIn := token.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	c.accessToken = token.AccessToken
	c.tokenExpiry = c.now().Add(time.Duration(expiresIn) * time.Second)
	return c.accessToken, nil
}

func (c *Client) storeAlbum(album Album) {
	c.albumCache.Store(album.ID, cachedAlbum{album: album, cachedAt: c.now()})
	c.pruneCache(&c.albumCache, maxDetailCacheSize)
}

func (c *Client) storeArtist(artist ArtistDetails) {
	c.artistCache.Store(artist.ID, cachedArtist{artist: artist, cachedAt: c.now()})
	c.pruneCache(&c.artistCache, maxArtistCacheSize)
}

func (c *Client) pruneCache(cache *sync.Map, maxSize int) {
	count := 0
	cache.Range(func(_, _ any) bool {
		count++
		return true
	})
	if count <= maxSize {
		return
	}
	removed := 0
	overflow := count - maxSize
	cache.Range(func(key, _ any) bool {
		if removed >= overflow {
			return false
		}
		cache.Delete(key)
		removed++
		return true
	})
}

func mapAlbum(payload spotifyAlbumPayload) Album {
	if payload.ID == "" {
		return Album{}
	}
	artists := make([]string, 0, len(payload.Artists))
	artistIDs := make([]string, 0, len(payload.Artists))
	for _, artist := range payload.Artists {
		if artist.Name != "" {
			artists = append(artists, artist.Name)
		}
		if artist.ID != "" {
			artistIDs = append(artistIDs, artist.ID)
		}
	}
	year := parseYear(payload.ReleaseDate)
	genres := payload.Genres
	if genres == nil {
		genres = []string{}
	}
	tracks := mapTracks(payload.Tracks)
	return Album{
		ID:          payload.ID,
		Name:        payload.Name,
		Artists:     artists,
		ArtistIDs:   artistIDs,
		ImageURL:    pickImage(payload.Images),
		ReleaseDate: payload.ReleaseDate,
		Year:        year,
		AlbumType:   payload.AlbumType,
		TotalTracks: payload.TotalTracks,
		Label:       payload.Label,
		Genres:      genres,
		Popularity:  payload.Popularity,
		Tracks:      tracks,
	}
}

func mapTracks(payload *struct {
	Items []spotifyTrackPayload `json:"items"`
}) []Track {
	if payload == nil || len(payload.Items) == 0 {
		return nil
	}
	tracks := make([]Track, 0, len(payload.Items))
	for _, item := range payload.Items {
		if item.ID == "" && item.Name == "" {
			continue
		}
		artists := make([]string, 0, len(item.Artists))
		for _, artist := range item.Artists {
			if artist.Name != "" {
				artists = append(artists, artist.Name)
			}
		}
		disc := item.DiscNumber
		if disc <= 0 {
			disc = 1
		}
		tracks = append(tracks, Track{
			ID:          item.ID,
			Name:        item.Name,
			Artists:     artists,
			TrackNumber: item.TrackNumber,
			DiscNumber:  disc,
			DurationMs:  item.DurationMs,
			Explicit:    item.Explicit,
		})
	}
	return tracks
}

func mapArtist(payload spotifyArtistPayload) Artist {
	if payload.ID == "" {
		return Artist{}
	}
	genres := payload.Genres
	if genres == nil {
		genres = []string{}
	}
	return Artist{
		ID:         payload.ID,
		Name:       payload.Name,
		ImageURL:   pickImage(payload.Images),
		Genres:     genres,
		Followers:  payload.Followers.Total,
		Popularity: payload.Popularity,
	}
}

func pickImage(images []spotifyImage) string {
	if len(images) == 0 {
		return fallbackImage
	}
	best := images[0]
	for _, image := range images[1:] {
		if image.Width > best.Width {
			best = image
		}
	}
	if best.URL == "" {
		return fallbackImage
	}
	return best.URL
}

func parseYear(releaseDate string) *int {
	if len(releaseDate) < 4 {
		return nil
	}
	year, err := strconv.Atoi(releaseDate[:4])
	if err != nil || year <= 0 {
		return nil
	}
	return &year
}
