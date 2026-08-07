package musicbrainz

import (
	"context"
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
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

const (
	defaultAPIBaseURL  = "https://musicbrainz.org/ws/2"
	defaultCoverBase   = "https://coverartarchive.org"
	fallbackImage      = "https://placehold.co/640x640/18181b/a1a1aa?text=No+Cover"
	userAgent          = "JedFlix/1.0 (https://github.com/JedBorseth/jedflix)"
	defaultLimit       = 10
	catalogShelfLimit  = 10
	discographyLimit   = 25
	maxDetailCacheSize = 400
	maxArtistCacheSize = 200
	maxSearchCacheSize = 500
	searchCacheTTL     = 30 * time.Minute
	minRequestInterval = 1100 * time.Millisecond // MusicBrainz asks for ≤1 req/s
)

var mbidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Enricher optionally supplies Last.fm charts, top tracks, and artist images.
type Enricher interface {
	Configured() bool
	ArtistImage(ctx context.Context, name string) (string, error)
	ArtistTopTracks(ctx context.Context, name string, limit int) ([]musiccatalog.TopTrack, error)
	TagTopArtists(ctx context.Context, tag string, limit int) ([]string, error)
	TagTopAlbums(ctx context.Context, tag string, limit int) ([]TagAlbumHint, error)
}

type TagAlbumHint struct {
	Name   string
	Artist string
}

type Client struct {
	apiBaseURL  string
	coverBase   string
	http        *http.Client
	refreshTTL  time.Duration
	genres      []musiccatalog.GenreConfig
	catalogPath string
	enricher    Enricher

	rateMu   sync.Mutex
	lastReq  time.Time
	now      func() time.Time

	catalogMu  sync.RWMutex
	catalog    *musiccatalog.BrowseResponse
	refreshing bool
	refreshErr error

	albumCache  sync.Map
	artistCache sync.Map
	searchCache sync.Map
	albumSummaries  sync.Map
	artistSummaries sync.Map
}

type cachedSearch struct {
	result   musiccatalog.SearchResponse
	cachedAt time.Time
}

type cachedAlbum struct {
	album    musiccatalog.Album
	cachedAt time.Time
}

type cachedArtist struct {
	artist   musiccatalog.ArtistDetails
	cachedAt time.Time
}

func NewClient(cfg config.Config) *Client {
	httpClient := cfg.HTTPClient()
	httpClient.Timeout = 45 * time.Second
	// Follow Cover Art Archive redirects when we probe covers.
	httpClient.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		return nil
	}

	apiBase := strings.TrimRight(cfg.MusicBrainzAPIBaseURL, "/")
	if apiBase == "" {
		apiBase = defaultAPIBaseURL
	}
	coverBase := strings.TrimRight(cfg.CoverArtArchiveBaseURL, "/")
	if coverBase == "" {
		coverBase = defaultCoverBase
	}
	ttl := cfg.MusicCatalogCacheTTL
	if ttl <= 0 {
		ttl = 6 * time.Hour
	}
	path := strings.TrimSpace(cfg.MusicCatalogPath)
	if path == "" {
		path = strings.TrimSpace(cfg.SpotifyCatalogPath)
	}

	return &Client{
		apiBaseURL:  apiBase,
		coverBase:   coverBase,
		http:        httpClient,
		refreshTTL:  ttl,
		genres:      musiccatalog.DefaultGenres,
		catalogPath: path,
		now:         time.Now,
	}
}

func (c *Client) SetEnricher(e Enricher) {
	c.enricher = e
}

func (c *Client) Configured() bool {
	return c != nil
}

func (c *Client) Start(ctx context.Context) {
	if !c.Configured() {
		return
	}
	loaded := c.loadPersistedCatalog()
	go c.refreshLoop(ctx, !loaded)
}

func (c *Client) refreshLoop(ctx context.Context, immediate bool) {
	if immediate {
		c.refreshCatalog(ctx)
	}
	ticker := time.NewTicker(c.refreshTTL)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.refreshCatalog(ctx)
		}
	}
}

func (c *Client) Browse(ctx context.Context) (*musiccatalog.BrowseResponse, error) {
	if !c.Configured() {
		return nil, musiccatalog.ErrNotConfigured
	}
	c.catalogMu.RLock()
	cached := c.catalog
	c.catalogMu.RUnlock()
	if cached != nil {
		copy := *cached
		return &copy, nil
	}
	c.refreshCatalog(ctx)
	c.catalogMu.RLock()
	cached = c.catalog
	err := c.refreshErr
	c.catalogMu.RUnlock()
	if cached != nil {
		copy := *cached
		return &copy, nil
	}
	if err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("%w: catalog unavailable", musiccatalog.ErrFetchFailed)
}

func (c *Client) Search(ctx context.Context, query string) (*musiccatalog.SearchResponse, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: query is required", musiccatalog.ErrBadRequest)
	}
	cacheKey := strings.ToLower(query)
	if cached, ok := c.searchCache.Load(cacheKey); ok {
		entry := cached.(cachedSearch)
		if c.now().Sub(entry.cachedAt) < searchCacheTTL {
			copy := entry.result
			return &copy, nil
		}
	}

	artists, errArtists := c.searchArtists(ctx, query, defaultLimit)
	albums, errAlbums := c.searchAlbums(ctx, query, defaultLimit)
	tracks, errTracks := c.searchRecordings(ctx, query, defaultLimit)

	if len(artists) == 0 && len(albums) == 0 && len(tracks) == 0 {
		if errArtists != nil {
			return nil, errArtists
		}
		if errAlbums != nil {
			return nil, errAlbums
		}
		if errTracks != nil {
			return nil, errTracks
		}
	}

	result := musiccatalog.SearchResponse{
		Albums:  albums,
		Artists: artists,
		Tracks:  tracks,
	}
	c.trimSearchCache()
	c.searchCache.Store(cacheKey, cachedSearch{result: result, cachedAt: c.now()})
	for _, a := range artists {
		c.rememberArtistSummary(a)
	}
	for _, a := range albums {
		c.rememberAlbumSummary(a)
	}
	return &result, nil
}

func (c *Client) GetAlbum(ctx context.Context, albumID string) (*musiccatalog.Album, error) {
	return c.GetAlbumWithHints(ctx, albumID, musiccatalog.AlbumHints{})
}

func (c *Client) GetAlbumWithHints(ctx context.Context, albumID string, hints musiccatalog.AlbumHints) (*musiccatalog.Album, error) {
	albumID = NormalizeMBID(albumID)
	if albumID == "" {
		if hints.Name != "" {
			return c.resolveAlbumByName(ctx, hints.Name, firstNonEmpty(hints.Artists...))
		}
		return nil, fmt.Errorf("%w: album id is required", musiccatalog.ErrBadRequest)
	}
	if cached, ok := c.albumCache.Load(albumID); ok {
		entry := cached.(cachedAlbum)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL {
			copy := entry.album
			return &copy, nil
		}
	}

	album, err := c.fetchReleaseGroupAlbum(ctx, albumID, true)
	if err != nil {
		if hints.Name != "" {
			return c.resolveAlbumByName(ctx, hints.Name, firstNonEmpty(hints.Artists...))
		}
		return nil, err
	}
	c.trimAlbumCache()
	c.albumCache.Store(albumID, cachedAlbum{album: *album, cachedAt: c.now()})
	c.rememberAlbumSummary(*album)
	return album, nil
}

func (c *Client) GetArtist(ctx context.Context, artistID string) (*musiccatalog.ArtistDetails, error) {
	return c.GetArtistWithHints(ctx, artistID, musiccatalog.ArtistHints{})
}

func (c *Client) GetArtistWithHints(ctx context.Context, artistID string, hints musiccatalog.ArtistHints) (*musiccatalog.ArtistDetails, error) {
	artistID = NormalizeMBID(artistID)
	if artistID == "" {
		if hints.Name != "" {
			resolved, err := c.resolveArtistByName(ctx, hints.Name)
			if err != nil {
				return nil, err
			}
			artistID = resolved.ID
		} else {
			return nil, fmt.Errorf("%w: artist id is required", musiccatalog.ErrBadRequest)
		}
	}
	if cached, ok := c.artistCache.Load(artistID); ok {
		entry := cached.(cachedArtist)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL {
			copy := entry.artist
			return &copy, nil
		}
	}

	details, err := c.fetchArtistDetails(ctx, artistID)
	if err != nil {
		return nil, err
	}
	c.trimArtistCache()
	c.artistCache.Store(artistID, cachedArtist{artist: *details, cachedAt: c.now()})
	c.rememberArtistSummary(details.Artist)
	return details, nil
}

func (c *Client) ListArtistAlbums(ctx context.Context, artistID string, limit int, hints musiccatalog.ArtistHints) ([]musiccatalog.Album, error) {
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > 25 {
		limit = 25
	}
	details, err := c.GetArtistWithHints(ctx, artistID, hints)
	if err != nil {
		return nil, err
	}
	albums := details.Albums
	if len(albums) == 0 {
		albums = details.Discography
	}
	if len(albums) > limit {
		albums = albums[:limit]
	}
	return albums, nil
}

func NormalizeMBID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.Contains(value, "/") {
		parts := strings.Split(value, "/")
		value = parts[len(parts)-1]
	}
	value = strings.Split(value, "?")[0]
	if mbidPattern.MatchString(value) {
		return strings.ToLower(value)
	}
	return ""
}

func (c *Client) waitRate(ctx context.Context) error {
	c.rateMu.Lock()
	defer c.rateMu.Unlock()
	elapsed := c.now().Sub(c.lastReq)
	if elapsed < minRequestInterval {
		wait := minRequestInterval - elapsed
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
	}
	c.lastReq = c.now()
	return nil
}

func (c *Client) getJSON(ctx context.Context, path string, query url.Values, dest any) error {
	if err := c.waitRate(ctx); err != nil {
		return err
	}
	if query == nil {
		query = url.Values{}
	}
	query.Set("fmt", "json")
	endpoint := c.apiBaseURL + path + "?" + query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return fmt.Errorf("%w: read body", musiccatalog.ErrFetchFailed)
	}
	switch res.StatusCode {
	case http.StatusOK:
		if err := json.Unmarshal(body, dest); err != nil {
			return fmt.Errorf("%w: decode json", musiccatalog.ErrFetchFailed)
		}
		return nil
	case http.StatusNotFound:
		return musiccatalog.ErrNotFound
	case http.StatusBadRequest:
		return musiccatalog.ErrBadRequest
	case http.StatusServiceUnavailable, http.StatusTooManyRequests:
		return musiccatalog.ErrRateLimited
	default:
		return fmt.Errorf("%w: status %d", musiccatalog.ErrFetchFailed, res.StatusCode)
	}
}

func (c *Client) coverURL(releaseGroupID string) string {
	if releaseGroupID == "" {
		return fallbackImage
	}
	return c.coverBase + "/release-group/" + releaseGroupID + "/front-500"
}

func (c *Client) rememberAlbumSummary(album musiccatalog.Album) {
	if album.ID == "" {
		return
	}
	summary := album
	summary.Tracks = nil
	c.albumSummaries.Store(album.ID, summary)
}

func (c *Client) rememberArtistSummary(artist musiccatalog.Artist) {
	if artist.ID == "" {
		return
	}
	c.artistSummaries.Store(artist.ID, artist)
}

func (c *Client) trimSearchCache() {
	trimSyncMap(&c.searchCache, maxSearchCacheSize)
}

func (c *Client) trimAlbumCache() {
	trimSyncMap(&c.albumCache, maxDetailCacheSize)
}

func (c *Client) trimArtistCache() {
	trimSyncMap(&c.artistCache, maxArtistCacheSize)
}

func trimSyncMap(m *sync.Map, max int) {
	count := 0
	m.Range(func(_, _ any) bool {
		count++
		return true
	})
	if count < max {
		return
	}
	removed := 0
	need := count - max + max/10
	m.Range(func(key, _ any) bool {
		m.Delete(key)
		removed++
		return removed < need
	})
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func parseYear(date string) *int {
	date = strings.TrimSpace(date)
	if len(date) < 4 {
		return nil
	}
	year, err := strconv.Atoi(date[:4])
	if err != nil || year < 1000 {
		return nil
	}
	return &year
}

func mapPrimaryType(primary string) string {
	switch strings.ToLower(strings.TrimSpace(primary)) {
	case "single":
		return "single"
	case "ep":
		return "ep"
	case "broadcast":
		return "compilation"
	default:
		return "album"
	}
}
