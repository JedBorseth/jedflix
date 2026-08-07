package spotify

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

const (
	defaultAPIBaseURL = "https://api.spotify.com/v1"
	defaultAuthURL    = "https://accounts.spotify.com/api/token"
	fallbackImage     = "https://placehold.co/640x640/18181b/a1a1aa?text=No+Cover"
	// Development Mode caps GET /search (and several list endpoints) at limit=10.
	defaultLimit        = 10
	catalogPageCount    = 2 // 2 × 10 ≈ 20 items per shelf
	featuredAlbumLimit  = 10
	discographyMaxPages = 5 // 5 × 10 = up to 50 releases
	// Dev Mode artist pages rebuild via search — keep this small to protect quota.
	artistSearchMaxPages     = 2 // 2 × 10 ≈ 20 releases
	albumTrackSearchPages    = 1 // one page is enough for most albums under Dev Mode
	maxDetailCacheSize       = 400
	maxArtistCacheSize       = 200
	maxSearchCacheSize       = 500
	searchCacheTTL           = 30 * time.Minute
	defaultRateLimitCooldown = 45 * time.Second
	maxRateLimitCooldown     = 2 * time.Minute
	tokenRefreshSkew         = 60 * time.Second
	defaultMarket            = "US"
)

var spotifyIDPattern = regexp.MustCompile(`^[a-zA-Z0-9]{22}$`)

type Client struct {
	apiBaseURL   string
	authURL      string
	clientID     string
	clientSecret string
	http         *http.Client
	refreshTTL   time.Duration
	genres       []GenreConfig

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time

	catalogMu  sync.RWMutex
	catalog    *BrowseResponse
	refreshing bool
	refreshErr error

	albumCache  sync.Map // id -> cachedAlbum
	artistCache sync.Map // id -> cachedArtist
	searchCache sync.Map // query key -> cachedSearch
	// Lightweight summaries remembered from search/browse for Dev Mode fallbacks.
	albumSummaries  sync.Map // id -> Album (may omit tracks)
	artistSummaries sync.Map // id -> Artist
	requestSem      chan struct{}
	catalogPath     string

	rateLimitMu    sync.Mutex
	rateLimitUntil time.Time

	now func() time.Time
}

type cachedSearch struct {
	result   SearchResponse
	cachedAt time.Time
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
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	TrackNumber int                  `json:"track_number"`
	DiscNumber  int                  `json:"disc_number"`
	DurationMs  int                  `json:"duration_ms"`
	Explicit    bool                 `json:"explicit"`
	Artists     []spotifyArtistRef   `json:"artists"`
	Album       *spotifyAlbumPayload `json:"album"`
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
	Tracks *struct {
		Items []spotifyTrackPayload `json:"items"`
	} `json:"tracks"`
}

type artistAlbumsResponse struct {
	Items []spotifyAlbumPayload `json:"items"`
	Next  string                `json:"next"`
	Total int                   `json:"total"`
}

type artistTopTracksResponse struct {
	Tracks []spotifyTrackPayload `json:"tracks"`
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
		genres:       DefaultGenres,
		requestSem:   make(chan struct{}, 2), // Dev Mode quota is tiny — stay conservative
		catalogPath:  strings.TrimSpace(cfg.SpotifyCatalogPath),
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
	loaded := c.loadPersistedCatalog()
	go c.refreshLoop(ctx, loaded)
}

func (c *Client) refreshLoop(ctx context.Context, hadPersisted bool) {
	// Prefer serving a persisted catalog immediately after restart. Only hit
	// Spotify when the cache is missing or past TTL — avoids deploy stampede.
	if !hadPersisted || c.catalogAge() >= c.refreshTTL {
		_ = c.Refresh(ctx)
	}

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

	rows := make([]CatalogRow, 0, len(c.genres)*3+1)
	var newReleases []Album
	var lastErr error

	for _, genre := range c.genres {
		if ctx.Err() != nil {
			lastErr = ctx.Err()
			break
		}
		genreRows, genreErr := c.fetchGenreRows(ctx, genre)
		if genreErr != nil {
			lastErr = genreErr
			if errors.Is(genreErr, ErrRateLimited) {
				break
			}
			continue
		}
		for _, catalogRow := range genreRows {
			if (catalogRow.Kind == "albums" && len(catalogRow.Albums) == 0) ||
				(catalogRow.Kind == "artists" && len(catalogRow.Artists) == 0) {
				continue
			}
			rows = append(rows, catalogRow)
		}
	}

	// New Releases stays search-based (`tag:new`) — not a genre keyword shelf.
	if lastErr == nil || !errors.Is(lastErr, ErrRateLimited) {
		if newRow, newErr := c.fetchNewReleasesRow(ctx); newErr != nil {
			lastErr = newErr
		} else {
			newReleases = newRow.Albums
			rows = append(rows, newRow)
		}
	}

	if len(rows) == 0 {
		err := lastErr
		if err == nil {
			err = fmt.Errorf("%w: empty catalog", ErrFetchFailed)
		}
		c.catalogMu.Lock()
		// Keep any previously loaded/persisted catalog so Browse stays available.
		if c.catalog == nil {
			c.refreshErr = err
		}
		c.catalogMu.Unlock()
		return err
	}

	response := &BrowseResponse{
		NewReleases: newReleases,
		Rows:        rows,
		CachedAt:    c.now().UnixMilli(),
	}
	c.applyCatalog(response)
	c.savePersistedCatalog(response)
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
		copied := *catalog
		return &copied, nil
	}
	if refreshErr != nil {
		return nil, refreshErr
	}

	if err := c.Refresh(ctx); err != nil {
		c.catalogMu.RLock()
		catalog = c.catalog
		c.catalogMu.RUnlock()
		if catalog != nil {
			copied := *catalog
			return &copied, nil
		}
		return nil, err
	}

	c.catalogMu.RLock()
	defer c.catalogMu.RUnlock()
	if c.catalog == nil {
		return nil, fmt.Errorf("%w: empty catalog", ErrFetchFailed)
	}
	copied := *c.catalog
	return &copied, nil
}

func (c *Client) Search(ctx context.Context, query string) (*SearchResponse, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: empty query", ErrBadRequest)
	}

	cacheKey := "album,artist,track|" + strings.ToLower(query)
	if cached, ok := c.searchCache.Load(cacheKey); ok {
		entry := cached.(cachedSearch)
		if c.now().Sub(entry.cachedAt) < searchCacheTTL {
			copy := entry.result
			return &copy, nil
		}
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("type", "album,artist,track")
	params.Set("limit", strconv.Itoa(defaultLimit))

	var payload searchResponsePayload
	if err := c.getJSON(ctx, "/search?"+params.Encode(), &payload); err != nil {
		return nil, err
	}

	result := &SearchResponse{
		Albums:  make([]Album, 0),
		Artists: make([]Artist, 0),
		Tracks:  make([]TopTrack, 0),
	}
	if payload.Albums != nil {
		for _, item := range payload.Albums.Items {
			if album := mapAlbum(item); album.ID != "" {
				c.rememberAlbumSummary(album)
				result.Albums = append(result.Albums, album)
			}
		}
	}
	if payload.Artists != nil {
		for _, item := range payload.Artists.Items {
			if artist := mapArtist(item); artist.ID != "" {
				c.rememberArtistSummary(artist)
				result.Artists = append(result.Artists, artist)
			}
		}
	}
	if payload.Tracks != nil {
		result.Tracks = mapTopTracks(payload.Tracks.Items)
		for _, track := range result.Tracks {
			if track.AlbumID != "" && track.AlbumName != "" {
				c.rememberAlbumSummary(Album{
					ID:        track.AlbumID,
					Name:      track.AlbumName,
					Artists:   track.Artists,
					ArtistIDs: track.ArtistIDs,
					ImageURL:  track.ImageURL,
				})
			}
			for i, artistID := range track.ArtistIDs {
				name := ""
				if i < len(track.Artists) {
					name = track.Artists[i]
				}
				if artistID != "" && name != "" {
					c.rememberArtistSummary(Artist{ID: artistID, Name: name, ImageURL: track.ImageURL, Genres: []string{}})
				}
			}
		}
	}

	sortSearchByRelevance(query, result)

	c.searchCache.Store(cacheKey, cachedSearch{result: *result, cachedAt: c.now()})
	c.pruneCache(&c.searchCache, maxSearchCacheSize)

	return result, nil
}

func (c *Client) GetAlbum(ctx context.Context, albumID string) (*Album, error) {
	return c.GetAlbumWithHints(ctx, albumID, AlbumHints{})
}

// AlbumHints help rebuild album details when Spotify Dev Mode blocks /albums/{id}.
type AlbumHints struct {
	Name    string
	Artists []string
}

func (c *Client) GetAlbumWithHints(ctx context.Context, albumID string, hints AlbumHints) (*Album, error) {
	if !c.Configured() {
		return nil, ErrNotConfigured
	}
	albumID = NormalizeID(albumID)
	if albumID == "" {
		return nil, fmt.Errorf("%w: invalid album id", ErrBadRequest)
	}

	if cached, ok := c.albumCache.Load(albumID); ok {
		entry := cached.(cachedAlbum)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL && len(entry.album.Tracks) > 0 {
			album := entry.album
			return &album, nil
		}
	}

	var payload spotifyAlbumPayload
	params := url.Values{}
	params.Set("market", defaultMarket)
	err := c.getJSON(ctx, "/albums/"+url.PathEscape(albumID)+"?"+params.Encode(), &payload)
	if err == nil {
		album := mapAlbum(payload)
		if album.ID == "" {
			return nil, ErrNotFound
		}
		c.storeAlbum(album)
		c.rememberAlbumSummary(album)
		return &album, nil
	}

	// Dev Mode often forbids direct album lookups — rebuild via search using hints/catalog.
	summary := c.lookupAlbumSummary(albumID, hints)
	if summary.Name == "" {
		return nil, err
	}
	tracks, trackErr := c.searchAlbumTracks(ctx, albumID, summary.Name, summary.Artists)
	if trackErr != nil {
		// Prefer a partial album (name/art) over failing the whole page during rate limits.
		summary.Tracks = []Track{}
		c.rememberAlbumSummary(summary)
		return &summary, nil
	}
	summary.Tracks = tracks
	if summary.TotalTracks == 0 {
		summary.TotalTracks = len(tracks)
	}
	c.storeAlbum(summary)
	return &summary, nil
}

func (c *Client) GetArtist(ctx context.Context, artistID string) (*ArtistDetails, error) {
	return c.GetArtistWithHints(ctx, artistID, ArtistHints{})
}

// ArtistHints help rebuild artist pages when Spotify Dev Mode blocks /artists/{id}.
type ArtistHints struct {
	Name string
}

func (c *Client) GetArtistWithHints(ctx context.Context, artistID string, hints ArtistHints) (*ArtistDetails, error) {
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

	artist := Artist{}
	var payload spotifyArtistPayload
	if err := c.getJSON(ctx, "/artists/"+url.PathEscape(artistID), &payload); err != nil {
		artist = c.lookupArtistSummary(artistID, hints)
		if artist.Name == "" {
			return nil, err
		}
	} else {
		artist = mapArtist(payload)
		if artist.ID == "" {
			return nil, ErrNotFound
		}
	}
	c.rememberArtistSummary(artist)

	topTracks, err := c.resolveArtistTopTracks(ctx, artistID, artist.Name, nil)
	if err != nil {
		topTracks = []TopTrack{}
	}
	if topTracks == nil {
		topTracks = []TopTrack{}
	}

	discography, err := c.fetchArtistAlbums(ctx, artistID, discographyMaxPages*defaultLimit, "album,single,compilation")
	if err != nil || len(discography) == 0 {
		// Cap search rebuild — each page is a Spotify request under Dev Mode.
		if searched, searchErr := c.searchArtistAlbums(ctx, artistID, artist.Name, artistSearchMaxPages*defaultLimit); searchErr == nil {
			discography = searched
		} else if len(discography) == 0 {
			discography = []Album{}
		}
	}
	if discography == nil {
		discography = []Album{}
	}

	// Intentionally do NOT call topTracksFromAlbums here. That fans out into
	// per-album lookups/searches and is what exhausted Dev Mode quota after
	// Last.fm + detail fallbacks landed.

	albums := discography
	if len(albums) > featuredAlbumLimit {
		albums = albums[:featuredAlbumLimit]
	}
	featured := make([]Album, len(albums))
	copy(featured, albums)

	details := ArtistDetails{
		Artist:      artist,
		TopTracks:   topTracks,
		Albums:      featured,
		Discography: discography,
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
		catalogRow, err := c.fetchCatalogRowFromPlaylist(ctx, row)
		if err == nil {
			return catalogRow, nil
		}
		// Development Mode forbids public playlist contents (403). Fall back to search.
		if row.Query == "" {
			return CatalogRow{}, err
		}
	}
	return c.fetchCatalogRowFromSearch(ctx, row)
}

func (c *Client) fetchCatalogRowFromPlaylist(ctx context.Context, row RowConfig) (CatalogRow, error) {
	if row.Kind == "artists" {
		artists, err := c.fetchPlaylistArtists(ctx, row.PlaylistID, catalogPageCount*defaultLimit)
		if err != nil {
			return CatalogRow{}, err
		}
		if len(artists) == 0 {
			return CatalogRow{}, fmt.Errorf("%w: empty playlist artists", ErrFetchFailed)
		}
		return CatalogRow{
			Title:   row.Title,
			Key:     row.Key,
			Kind:    "artists",
			Artists: artists,
		}, nil
	}
	albums, err := c.fetchPlaylistAlbums(ctx, row.PlaylistID, catalogPageCount*defaultLimit)
	if err != nil {
		return CatalogRow{}, err
	}
	if len(albums) == 0 {
		return CatalogRow{}, fmt.Errorf("%w: empty playlist albums", ErrFetchFailed)
	}
	return CatalogRow{
		Title:  row.Title,
		Key:    row.Key,
		Kind:   "albums",
		Albums: albums,
	}, nil
}

func (c *Client) fetchCatalogRowFromSearch(ctx context.Context, row RowConfig) (CatalogRow, error) {
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
			Album   *spotifyAlbumPayload `json:"album"`
			Artists []spotifyArtistRef   `json:"artists"`
		} `json:"track"`
	} `json:"items"`
	Next string `json:"next"`
}

func playlistNextPath(apiBaseURL, next string) string {
	next = strings.TrimSpace(next)
	if next == "" {
		return ""
	}
	if strings.HasPrefix(next, apiBaseURL) {
		return strings.TrimPrefix(next, apiBaseURL)
	}
	if u, err := url.Parse(next); err == nil && u.Path != "" {
		path := u.Path
		if u.RawQuery != "" {
			path += "?" + u.RawQuery
		}
		return path
	}
	return ""
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
		path = playlistNextPath(c.apiBaseURL, payload.Next)
	}
	return albums, nil
}

func (c *Client) fetchPlaylistArtists(ctx context.Context, playlistID string, maxItems int) ([]Artist, error) {
	playlistID = NormalizeID(playlistID)
	if playlistID == "" {
		return nil, fmt.Errorf("%w: invalid playlist id", ErrBadRequest)
	}
	if maxItems <= 0 {
		maxItems = catalogPageCount * defaultLimit
	}

	ids := make([]string, 0, maxItems)
	seen := make(map[string]struct{})
	path := "/playlists/" + url.PathEscape(playlistID) + "/tracks?limit=50&fields=items(track(artists(id,name))),next"

	for path != "" && len(ids) < maxItems {
		var payload playlistTracksPayload
		if err := c.getJSON(ctx, path, &payload); err != nil {
			if len(ids) > 0 {
				break
			}
			return nil, err
		}
		for _, item := range payload.Items {
			if item.Track == nil || len(item.Track.Artists) == 0 {
				continue
			}
			// Primary artist of each playlist track, in playlist order.
			artistID := NormalizeID(item.Track.Artists[0].ID)
			if artistID == "" {
				continue
			}
			if _, ok := seen[artistID]; ok {
				continue
			}
			seen[artistID] = struct{}{}
			ids = append(ids, artistID)
			if len(ids) >= maxItems {
				break
			}
		}
		path = playlistNextPath(c.apiBaseURL, payload.Next)
	}
	if len(ids) == 0 {
		return []Artist{}, nil
	}
	return c.fetchArtistsByIDs(ctx, ids)
}

func (c *Client) fetchArtistsByIDs(ctx context.Context, ids []string) ([]Artist, error) {
	// Development Mode removed GET /artists?ids=… — fetch one at a time.
	byID := make(map[string]Artist, len(ids))
	for _, id := range ids {
		var payload spotifyArtistPayload
		if err := c.getJSON(ctx, "/artists/"+url.PathEscape(id), &payload); err != nil {
			continue
		}
		artist := mapArtist(payload)
		if artist.ID == "" {
			continue
		}
		byID[artist.ID] = artist
	}

	artists := make([]Artist, 0, len(ids))
	for _, id := range ids {
		if artist, ok := byID[id]; ok {
			artists = append(artists, artist)
		}
	}
	if len(artists) == 0 && len(ids) > 0 {
		return nil, fmt.Errorf("%w: unable to resolve playlist artists", ErrFetchFailed)
	}
	return artists, nil
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

func (c *Client) resolveArtistTopTracks(ctx context.Context, artistID, artistName string, _ []Album) ([]TopTrack, error) {
	tracks, err := c.fetchArtistTopTracksAPI(ctx, artistID)
	if err == nil && len(tracks) > 0 {
		return tracks, nil
	}
	// Development Mode often returns 403 for /artists/{id}/top-tracks.
	searched, searchErr := c.searchArtistTopTracks(ctx, artistID, artistName, featuredAlbumLimit)
	if searchErr == nil && len(searched) > 0 {
		return searched, nil
	}
	if err != nil {
		return nil, err
	}
	return tracks, searchErr
}

func (c *Client) fetchArtistTopTracksAPI(ctx context.Context, artistID string) ([]TopTrack, error) {
	params := url.Values{}
	params.Set("market", defaultMarket)
	var payload artistTopTracksResponse
	if err := c.getJSON(ctx, "/artists/"+url.PathEscape(artistID)+"/top-tracks?"+params.Encode(), &payload); err != nil {
		return nil, err
	}
	return mapTopTracks(payload.Tracks), nil
}

func (c *Client) searchArtistTopTracks(ctx context.Context, artistID, artistName string, limit int) ([]TopTrack, error) {
	if limit <= 0 || limit > defaultLimit {
		limit = defaultLimit
	}
	name := strings.TrimSpace(artistName)
	if name == "" {
		return nil, fmt.Errorf("%w: missing artist name for top track search", ErrBadRequest)
	}
	params := url.Values{}
	params.Set("q", name)
	params.Set("type", "track")
	params.Set("limit", strconv.Itoa(limit))
	params.Set("market", defaultMarket)

	var payload searchResponsePayload
	if err := c.getJSON(ctx, "/search?"+params.Encode(), &payload); err != nil {
		return nil, err
	}
	if payload.Tracks == nil || len(payload.Tracks.Items) == 0 {
		return []TopTrack{}, nil
	}

	seen := make(map[string]struct{})
	tracks := make([]TopTrack, 0, limit)
	for _, item := range payload.Tracks.Items {
		if item.ID == "" {
			continue
		}
		if _, ok := seen[item.ID]; ok {
			continue
		}
		belongsToArtist := false
		for _, artist := range item.Artists {
			if artist.ID == artistID {
				belongsToArtist = true
				break
			}
		}
		if !belongsToArtist {
			continue
		}
		seen[item.ID] = struct{}{}
		mapped := mapTopTracks([]spotifyTrackPayload{item})
		if len(mapped) == 0 {
			continue
		}
		tracks = append(tracks, mapped[0])
		if len(tracks) >= limit {
			break
		}
	}
	return tracks, nil
}

func (c *Client) topTracksFromAlbums(ctx context.Context, artistID string, albums []Album, limit int) []TopTrack {
	if limit <= 0 {
		limit = featuredAlbumLimit
	}
	seen := make(map[string]struct{})
	tracks := make([]TopTrack, 0, limit)
	for _, summary := range albums {
		if len(tracks) >= limit {
			break
		}
		album, err := c.GetAlbum(ctx, summary.ID)
		if err != nil || album == nil {
			continue
		}
		imageURL := album.ImageURL
		if imageURL == "" {
			imageURL = fallbackImage
		}
		for _, track := range album.Tracks {
			if track.ID == "" {
				continue
			}
			if _, ok := seen[track.ID]; ok {
				continue
			}
			if len(track.ArtistIDs) > 0 {
				belongs := false
				for _, id := range track.ArtistIDs {
					if id == artistID {
						belongs = true
						break
					}
				}
				if !belongs {
					continue
				}
			}
			seen[track.ID] = struct{}{}
			tracks = append(tracks, TopTrack{
				ID:          track.ID,
				Name:        track.Name,
				Artists:     track.Artists,
				ArtistIDs:   track.ArtistIDs,
				TrackNumber: track.TrackNumber,
				DiscNumber:  track.DiscNumber,
				DurationMs:  track.DurationMs,
				Explicit:    track.Explicit,
				AlbumID:     album.ID,
				AlbumName:   album.Name,
				ImageURL:    imageURL,
			})
			if len(tracks) >= limit {
				break
			}
		}
	}
	return tracks
}

func mapTopTracks(items []spotifyTrackPayload) []TopTrack {
	tracks := make([]TopTrack, 0, len(items))
	for _, item := range items {
		if item.ID == "" && item.Name == "" {
			continue
		}
		artists := make([]string, 0, len(item.Artists))
		artistIDs := make([]string, 0, len(item.Artists))
		for _, artist := range item.Artists {
			if artist.Name == "" {
				continue
			}
			artists = append(artists, artist.Name)
			artistIDs = append(artistIDs, artist.ID)
		}
		disc := item.DiscNumber
		if disc <= 0 {
			disc = 1
		}
		albumID := ""
		albumName := ""
		imageURL := fallbackImage
		if item.Album != nil {
			albumID = item.Album.ID
			albumName = item.Album.Name
			imageURL = pickImage(item.Album.Images)
		}
		tracks = append(tracks, TopTrack{
			ID:          item.ID,
			Name:        item.Name,
			Artists:     artists,
			ArtistIDs:   artistIDs,
			TrackNumber: item.TrackNumber,
			DiscNumber:  disc,
			DurationMs:  item.DurationMs,
			Explicit:    item.Explicit,
			AlbumID:     albumID,
			AlbumName:   albumName,
			ImageURL:    imageURL,
		})
	}
	return tracks
}

func (c *Client) fetchArtistAlbums(ctx context.Context, artistID string, maxItems int, includeGroups string) ([]Album, error) {
	if maxItems <= 0 {
		maxItems = featuredAlbumLimit
	}
	if strings.TrimSpace(includeGroups) == "" {
		includeGroups = "album,single,compilation"
	}
	seen := make(map[string]struct{})
	albums := make([]Album, 0, maxItems)

	for offset := 0; len(albums) < maxItems; offset += defaultLimit {
		params := url.Values{}
		params.Set("include_groups", includeGroups)
		params.Set("limit", strconv.Itoa(defaultLimit))
		params.Set("offset", strconv.Itoa(offset))
		params.Set("market", defaultMarket)

		var payload artistAlbumsResponse
		if err := c.getJSON(ctx, "/artists/"+url.PathEscape(artistID)+"/albums?"+params.Encode(), &payload); err != nil {
			if len(albums) > 0 {
				return albums, nil
			}
			return nil, err
		}
		if len(payload.Items) == 0 {
			break
		}
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
			if len(albums) >= maxItems {
				break
			}
		}
		if len(payload.Items) < defaultLimit || payload.Next == "" {
			break
		}
	}
	return albums, nil
}

func (c *Client) getJSON(ctx context.Context, path string, dest any) error {
	if err := c.checkRateLimit(); err != nil {
		return err
	}
	if c.requestSem != nil {
		select {
		case c.requestSem <- struct{}{}:
			defer func() { <-c.requestSem }()
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	// Re-check after waiting for a slot — another request may have tripped the breaker.
	if err := c.checkRateLimit(); err != nil {
		return err
	}

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
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	resp.Body.Close()
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
		c.mu.Lock()
		c.accessToken = ""
		c.tokenExpiry = time.Time{}
		c.mu.Unlock()
		// One immediate retry with a fresh token (does not loop on 429).
		token, err := c.getAccessToken(ctx)
		if err != nil {
			return err
		}
		req2, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiBaseURL+path, nil)
		if err != nil {
			return err
		}
		req2.Header.Set("Authorization", "Bearer "+token)
		req2.Header.Set("Accept", "application/json")
		resp2, err := c.http.Do(req2)
		if err != nil {
			return fmt.Errorf("%w: %v", ErrFetchFailed, err)
		}
		body2, err := io.ReadAll(io.LimitReader(resp2.Body, 4<<20))
		resp2.Body.Close()
		if err != nil {
			return fmt.Errorf("%w: read body: %v", ErrFetchFailed, err)
		}
		if resp2.StatusCode == http.StatusOK {
			if err := json.Unmarshal(body2, dest); err != nil {
				return fmt.Errorf("%w: decode: %v", ErrFetchFailed, err)
			}
			return nil
		}
		if resp2.StatusCode == http.StatusTooManyRequests {
			c.tripRateLimit(parseRetryAfter(resp2.Header.Get("Retry-After")))
			return fmt.Errorf("%w: %s", ErrRateLimited, strings.TrimSpace(string(body2)))
		}
		return fmt.Errorf("%w: status %d: %s", ErrFetchFailed, resp2.StatusCode, strings.TrimSpace(string(body2)))
	case http.StatusTooManyRequests:
		// Fail fast and open the circuit — retrying 429s only burns more quota.
		c.tripRateLimit(parseRetryAfter(resp.Header.Get("Retry-After")))
		return fmt.Errorf("%w: %s", ErrRateLimited, strings.TrimSpace(string(body)))
	default:
		return fmt.Errorf("%w: status %d: %s", ErrFetchFailed, resp.StatusCode, strings.TrimSpace(string(body)))
	}
}

func (c *Client) checkRateLimit() error {
	c.rateLimitMu.Lock()
	defer c.rateLimitMu.Unlock()
	if c.now().Before(c.rateLimitUntil) {
		return ErrRateLimited
	}
	return nil
}

func (c *Client) tripRateLimit(cooldown time.Duration) {
	if cooldown <= 0 {
		cooldown = defaultRateLimitCooldown
	}
	if cooldown > maxRateLimitCooldown {
		cooldown = maxRateLimitCooldown
	}
	c.rateLimitMu.Lock()
	until := c.now().Add(cooldown)
	if until.After(c.rateLimitUntil) {
		c.rateLimitUntil = until
	}
	c.rateLimitMu.Unlock()
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultRateLimitCooldown
	}
	if secs, err := strconv.Atoi(value); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	return defaultRateLimitCooldown
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
	c.rememberAlbumSummary(album)
	c.pruneCache(&c.albumCache, maxDetailCacheSize)
}

func (c *Client) storeArtist(artist ArtistDetails) {
	c.artistCache.Store(artist.ID, cachedArtist{artist: artist, cachedAt: c.now()})
	c.rememberArtistSummary(artist.Artist)
	c.pruneCache(&c.artistCache, maxArtistCacheSize)
}

func (c *Client) rememberAlbumSummary(album Album) {
	if album.ID == "" || album.Name == "" {
		return
	}
	c.albumSummaries.Store(album.ID, album)
}

func (c *Client) rememberArtistSummary(artist Artist) {
	if artist.ID == "" || artist.Name == "" {
		return
	}
	c.artistSummaries.Store(artist.ID, artist)
}

func (c *Client) lookupAlbumSummary(albumID string, hints AlbumHints) Album {
	if cached, ok := c.albumSummaries.Load(albumID); ok {
		album := cached.(Album)
		if album.Name != "" {
			return album
		}
	}
	if cached, ok := c.albumCache.Load(albumID); ok {
		album := cached.(cachedAlbum).album
		if album.Name != "" {
			return album
		}
	}
	c.catalogMu.RLock()
	catalog := c.catalog
	c.catalogMu.RUnlock()
	if catalog != nil {
		for _, album := range catalog.NewReleases {
			if album.ID == albumID {
				return album
			}
		}
		for _, row := range catalog.Rows {
			for _, album := range row.Albums {
				if album.ID == albumID {
					return album
				}
			}
		}
	}
	name := strings.TrimSpace(hints.Name)
	if name == "" {
		return Album{}
	}
	artists := make([]string, 0, len(hints.Artists))
	for _, artist := range hints.Artists {
		artist = strings.TrimSpace(artist)
		if artist != "" {
			artists = append(artists, artist)
		}
	}
	return Album{
		ID:      albumID,
		Name:    name,
		Artists: artists,
	}
}

func (c *Client) lookupArtistSummary(artistID string, hints ArtistHints) Artist {
	if cached, ok := c.artistSummaries.Load(artistID); ok {
		artist := cached.(Artist)
		if artist.Name != "" {
			return artist
		}
	}
	if cached, ok := c.artistCache.Load(artistID); ok {
		artist := cached.(cachedArtist).artist.Artist
		if artist.Name != "" {
			return artist
		}
	}
	c.catalogMu.RLock()
	catalog := c.catalog
	c.catalogMu.RUnlock()
	if catalog != nil {
		for _, row := range catalog.Rows {
			for _, artist := range row.Artists {
				if artist.ID == artistID {
					return artist
				}
			}
		}
		for _, album := range catalog.NewReleases {
			for i, id := range album.ArtistIDs {
				if id == artistID {
					name := ""
					if i < len(album.Artists) {
						name = album.Artists[i]
					}
					if name != "" {
						return Artist{ID: artistID, Name: name, ImageURL: album.ImageURL, Genres: []string{}}
					}
				}
			}
		}
	}
	name := strings.TrimSpace(hints.Name)
	if name == "" {
		return Artist{}
	}
	return Artist{ID: artistID, Name: name, Genres: []string{}}
}

func (c *Client) searchAlbumTracks(ctx context.Context, albumID, albumName string, artists []string) ([]Track, error) {
	albumName = strings.TrimSpace(albumName)
	if albumName == "" {
		return nil, fmt.Errorf("%w: missing album name for track search", ErrBadRequest)
	}
	query := fmt.Sprintf(`album:"%s"`, albumName)
	if len(artists) > 0 && strings.TrimSpace(artists[0]) != "" {
		query += fmt.Sprintf(` artist:"%s"`, strings.TrimSpace(artists[0]))
	}
	params := url.Values{}
	params.Set("q", query)
	params.Set("type", "track")
	params.Set("limit", strconv.Itoa(defaultLimit))
	params.Set("market", defaultMarket)

	seen := make(map[string]struct{})
	tracks := make([]Track, 0, defaultLimit*albumTrackSearchPages)
	for page := 0; page < albumTrackSearchPages && len(tracks) < 50; page++ {
		params.Set("offset", strconv.Itoa(page*defaultLimit))
		var payload searchResponsePayload
		if err := c.getJSON(ctx, "/search?"+params.Encode(), &payload); err != nil {
			if len(tracks) > 0 {
				return tracks, nil
			}
			return nil, err
		}
		if payload.Tracks == nil || len(payload.Tracks.Items) == 0 {
			break
		}
		for _, item := range payload.Tracks.Items {
			if item.ID == "" {
				continue
			}
			if item.Album != nil && item.Album.ID != "" && item.Album.ID != albumID {
				continue
			}
			if _, ok := seen[item.ID]; ok {
				continue
			}
			seen[item.ID] = struct{}{}
			mapped := mapTopTracks([]spotifyTrackPayload{item})
			if len(mapped) == 0 {
				continue
			}
			t := mapped[0]
			tracks = append(tracks, Track{
				ID:          t.ID,
				Name:        t.Name,
				Artists:     t.Artists,
				ArtistIDs:   t.ArtistIDs,
				TrackNumber: t.TrackNumber,
				DiscNumber:  t.DiscNumber,
				DurationMs:  t.DurationMs,
				Explicit:    t.Explicit,
			})
		}
		if len(payload.Tracks.Items) < defaultLimit {
			break
		}
	}
	return tracks, nil
}

func (c *Client) searchArtistAlbums(ctx context.Context, artistID, artistName string, maxItems int) ([]Album, error) {
	artistName = strings.TrimSpace(artistName)
	if artistName == "" {
		return nil, fmt.Errorf("%w: missing artist name for album search", ErrBadRequest)
	}
	if maxItems <= 0 {
		maxItems = featuredAlbumLimit
	}
	params := url.Values{}
	params.Set("q", fmt.Sprintf(`artist:"%s"`, artistName))
	params.Set("type", "album")
	params.Set("limit", strconv.Itoa(defaultLimit))
	params.Set("market", defaultMarket)

	seen := make(map[string]struct{})
	albums := make([]Album, 0, maxItems)
	maxPages := artistSearchMaxPages
	if maxItems > artistSearchMaxPages*defaultLimit {
		maxPages = (maxItems + defaultLimit - 1) / defaultLimit
		if maxPages > discographyMaxPages {
			maxPages = discographyMaxPages
		}
	}
	for page := 0; page < maxPages && len(albums) < maxItems; page++ {
		params.Set("offset", strconv.Itoa(page*defaultLimit))
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
			if len(album.ArtistIDs) > 0 {
				matched := false
				for _, id := range album.ArtistIDs {
					if id == artistID {
						matched = true
						break
					}
				}
				if !matched {
					continue
				}
			}
			if _, ok := seen[album.ID]; ok {
				continue
			}
			seen[album.ID] = struct{}{}
			c.rememberAlbumSummary(album)
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
		artistIDs := make([]string, 0, len(item.Artists))
		for _, artist := range item.Artists {
			if artist.Name == "" {
				continue
			}
			artists = append(artists, artist.Name)
			artistIDs = append(artistIDs, artist.ID)
		}
		disc := item.DiscNumber
		if disc <= 0 {
			disc = 1
		}
		tracks = append(tracks, Track{
			ID:          item.ID,
			Name:        item.Name,
			Artists:     artists,
			ArtistIDs:   artistIDs,
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
