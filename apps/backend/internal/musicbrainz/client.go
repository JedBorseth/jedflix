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
	"github.com/jedborseth/jeds-movies/backend/internal/musicai"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz/local"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
	"golang.org/x/sync/singleflight"
)

const (
	defaultAPIBaseURL         = "https://musicbrainz.org/ws/2"
	defaultCoverBase          = "https://coverartarchive.org"
	fallbackImage             = "https://placehold.co/640x640/18181b/a1a1aa?text=No+Cover"
	userAgent                 = "JedFlix/1.0 (https://github.com/JedBorseth/jedflix)"
	defaultLimit              = 10
	catalogShelfLimit         = 10
	discographyLimit          = 25
	maxDetailCacheSize        = 400
	maxArtistCacheSize        = 800
	homepageArtistWarmGap     = 2 * time.Second
	homepageArtistWarmTimeout = 45 * time.Second
	maxSearchCacheSize        = 500
	searchCacheTTL            = 30 * time.Minute
	minRequestInterval        = 1100 * time.Millisecond // MusicBrainz asks for ≤1 req/s
	maxHTTPRetries            = 4
)

var mbidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Enricher optionally supplies Last.fm charts, top tracks, and artist images.
// Browse prefers these hints (with MBIDs) so MusicBrainz outages don't empty the home page.
type Enricher interface {
	Configured() bool
	ArtistImage(ctx context.Context, name string) (string, error)
	ArtistTopTracks(ctx context.Context, name string, limit int) ([]musiccatalog.TopTrack, error)
	TagTopArtists(ctx context.Context, tag string, limit int) ([]TagArtistHint, error)
	TagTopAlbums(ctx context.Context, tag string, limit int) ([]TagAlbumHint, error)
	TagTopTracks(ctx context.Context, tag string, limit int) ([]musiccatalog.TopTrack, error)
	SearchArtists(ctx context.Context, query string, limit int) ([]TagArtistHint, error)
	SearchAlbums(ctx context.Context, query string, limit int) ([]TagAlbumHint, error)
	SearchTracks(ctx context.Context, query string, limit int) ([]musiccatalog.TopTrack, error)
}

type TagArtistHint struct {
	Name     string
	MBID     string
	ImageURL string
}

type TagAlbumHint struct {
	Name       string
	Artist     string
	MBID       string
	ArtistMBID string
	ImageURL   string
}

type Client struct {
	apiBaseURL      string
	coverBase       string
	coverPublicBase string
	artworkPath     string
	http            *http.Client
	refreshTTL      time.Duration
	genres          []musiccatalog.GenreConfig
	catalogPath     string
	enricher        Enricher
	local           *local.Store
	ai              *musicai.Client

	rateMu  sync.Mutex
	lastReq time.Time
	now     func() time.Time

	catalogMu     sync.RWMutex
	catalog       *musiccatalog.BrowseResponse
	refreshing    bool
	refreshErr    error
	artistWarming bool

	albumCache      sync.Map
	artistCache     sync.Map
	searchCache     sync.Map
	albumSummaries  sync.Map
	artistSummaries sync.Map

	artworkMem    sync.Map
	artworkDiskMu sync.Mutex
	artworkFetch  singleflight.Group
	coverRateMu   sync.Mutex
	lastCoverReq  time.Time
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
	// Follow Cover Art Archive redirects when we fetch covers.
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
	coverPublic := strings.TrimRight(cfg.MusicCoverPublicBase, "/")
	if coverPublic == "" {
		coverPublic = "/backend/api/v1/music/covers"
	}
	artworkPath := strings.TrimSpace(cfg.MusicArtworkPath)

	return &Client{
		apiBaseURL:      apiBase,
		coverBase:       coverBase,
		coverPublicBase: coverPublic,
		artworkPath:     artworkPath,
		http:            httpClient,
		refreshTTL:      ttl,
		genres:          musiccatalog.DefaultGenres,
		catalogPath:     path,
		now:             time.Now,
	}
}

// SetLocalStore wires a MusicBrainz Postgres replica for detail lookups.
func (c *Client) SetLocalStore(store *local.Store) {
	c.local = store
}

func (c *Client) SetEnricher(e Enricher) {
	c.enricher = e
}

func (c *Client) SetAI(ai *musicai.Client) {
	c.ai = ai
}

func (c *Client) LocalStore() *local.Store {
	if c == nil {
		return nil
	}
	return c.local
}

func (c *Client) LocalEnabled() bool {
	return c != nil && c.useLocalStore()
}

// ResolveArtistByName is a fast exact lookup used by Last.fm resolution.
func (c *Client) ResolveArtistByName(ctx context.Context, name string) (*musiccatalog.Artist, error) {
	return c.resolveArtistByName(ctx, name)
}

// ResolveTrackByName is a fast exact lookup used by Last.fm resolution.
func (c *Client) ResolveTrackByName(ctx context.Context, name, artist string) (*musiccatalog.TopTrack, error) {
	name = strings.TrimSpace(name)
	artist = strings.TrimSpace(artist)
	if name == "" || artist == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	if c.useLocalStore() {
		track, err := c.local.ResolveRecordingByName(ctx, name, artist)
		if err == nil && track != nil {
			enriched := c.enrichTrackArtwork(ctx, *track)
			return &enriched, nil
		}
		if err != nil && !errors.Is(err, musiccatalog.ErrNotFound) {
			return nil, err
		}
	}
	return nil, musiccatalog.ErrNotFound
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
		if c.catalogAge() >= c.refreshTTL {
			go c.refreshCatalog(context.Background())
		}
		return &copy, nil
	}

	go c.refreshCatalog(context.Background())
	c.waitForRefresh(ctx)

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

	var (
		artists    []musiccatalog.Artist
		albums     []musiccatalog.Album
		tracks     []musiccatalog.TopTrack
		errArtists error
		errAlbums  error
		errTracks  error
	)

	if hybrid, err := c.searchHybrid(ctx, query); err == nil && hybrid != nil &&
		(len(hybrid.Artists) > 0 || len(hybrid.Albums) > 0 || len(hybrid.Tracks) > 0) {
		if ctx.Err() == nil {
			c.trimSearchCache()
			c.searchCache.Store(cacheKey, cachedSearch{result: *hybrid, cachedAt: c.now()})
		}
		for _, a := range hybrid.Artists {
			c.rememberArtistSummary(a)
		}
		for _, a := range hybrid.Albums {
			c.rememberAlbumSummary(a)
		}
		c.WarmArtworkAsync(ctx, hybrid.Albums, hybrid.Tracks, hybrid.Artists)
		return hybrid, nil
	}

	if !c.useLocalStore() {
		artists, errArtists = c.searchArtists(ctx, query, defaultLimit)
		albums, errAlbums = c.searchAlbums(ctx, query, defaultLimit)
		tracks, errTracks = c.searchRecordings(ctx, query, defaultLimit)
	}

	if len(artists) == 0 && len(albums) == 0 && len(tracks) == 0 &&
		c.enricher != nil && c.enricher.Configured() {
		if hints, err := c.enricher.SearchArtists(ctx, query, defaultLimit); err == nil {
			artists = c.artistsFromHints(hints, defaultLimit)
		}
		if hints, err := c.enricher.SearchAlbums(ctx, query, defaultLimit); err == nil {
			albums = c.albumsFromHints(ctx, hints, defaultLimit)
		}
		if hits, err := c.enricher.SearchTracks(ctx, query, defaultLimit); err == nil {
			tracks = c.withTrackCoverURLs(ctx, hits)
		}
		errArtists, errAlbums, errTracks = nil, nil, nil
	}

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
	// Cache successful results, including Last.fm fallbacks that completed.
	// Skip empty/timed-out responses so a 45s miss cannot stick for 30 minutes.
	if ctx.Err() == nil && (len(artists) > 0 || len(albums) > 0 || len(tracks) > 0) {
		c.trimSearchCache()
		c.searchCache.Store(cacheKey, cachedSearch{result: result, cachedAt: c.now()})
	}
	for _, a := range artists {
		c.rememberArtistSummary(a)
	}
	for _, a := range albums {
		c.rememberAlbumSummary(a)
	}
	c.WarmArtworkAsync(ctx, albums, tracks, artists)
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
	requestedID := albumID
	if cached, ok := c.albumCache.Load(requestedID); ok {
		entry := cached.(cachedAlbum)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL {
			copy := entry.album
			return &copy, nil
		}
	}

	var (
		album *musiccatalog.Album
		err   error
	)
	if c.local != nil && c.local.Configured() {
		if rgID, canonErr := c.local.CanonicalReleaseGroupID(ctx, requestedID); canonErr == nil && rgID != "" {
			albumID = rgID
			if albumID != requestedID {
				if cached, ok := c.albumCache.Load(albumID); ok {
					entry := cached.(cachedAlbum)
					if c.now().Sub(entry.cachedAt) < c.refreshTTL {
						copy := entry.album
						c.albumCache.Store(requestedID, entry)
						return &copy, nil
					}
				}
			}
		}
		album, err = c.local.GetReleaseGroupAlbum(ctx, albumID, true)
		if album != nil {
			album.ImageURL = c.coverURL(album.ID)
		}
	} else {
		album, err = c.fetchReleaseGroupAlbum(ctx, albumID, true)
	}
	if err != nil {
		if hints.Name != "" {
			return c.resolveAlbumByName(ctx, hints.Name, firstNonEmpty(hints.Artists...))
		}
		return nil, err
	}
	c.trimAlbumCache()
	entry := cachedAlbum{album: *album, cachedAt: c.now()}
	c.albumCache.Store(albumID, entry)
	if requestedID != albumID {
		c.albumCache.Store(requestedID, entry)
	}
	c.rememberAlbumSummary(*album)
	c.WarmArtworkAsync(ctx, []musiccatalog.Album{*album}, nil, nil)
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

	var (
		details *musiccatalog.ArtistDetails
		err     error
	)
	if c.local != nil && c.local.Configured() {
		details, err = c.fetchArtistDetailsLocal(ctx, artistID)
	} else {
		details, err = c.fetchArtistDetails(ctx, artistID)
	}
	if err != nil {
		return nil, err
	}
	c.trimArtistCache()
	c.artistCache.Store(artistID, cachedArtist{artist: *details, cachedAt: c.now()})
	c.rememberArtistSummary(details.Artist)
	c.WarmArtworkAsync(ctx, details.Albums, details.TopTracks, []musiccatalog.Artist{details.Artist})
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

// SimilarTracks returns embedding-neighbor tracks for a recording MBID.
func (c *Client) SimilarTracks(ctx context.Context, trackID string, limit int) ([]musiccatalog.TopTrack, error) {
	if !c.useLocalStore() {
		return nil, nil
	}
	trackID = NormalizeMBID(trackID)
	if trackID == "" {
		return nil, fmt.Errorf("%w: track id is required", musiccatalog.ErrBadRequest)
	}
	if limit <= 0 {
		limit = defaultLimit
	}
	hits, err := c.local.SimilarTracks(ctx, trackID, limit)
	if err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return nil, nil
	}
	out := make([]musiccatalog.TopTrack, 0, len(hits))
	for _, hit := range hits {
		if hit.EntityType != "track" || hit.MBID == "" {
			continue
		}
		out = append(out, musiccatalog.TopTrack{
			ID:         hit.MBID,
			Name:       hit.Name,
			Artists:    hit.Artists,
			ArtistIDs:  hit.ArtistIDs,
			DurationMs: hit.DurationMs,
			AlbumID:    hit.AlbumID,
			AlbumName:  hit.AlbumName,
		})
	}
	return c.withTrackCoverURLs(ctx, out), nil
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
	if query == nil {
		query = url.Values{}
	}
	query.Set("fmt", "json")
	endpoint := c.apiBaseURL + path + "?" + query.Encode()

	var lastErr error
	for attempt := 0; attempt < maxHTTPRetries; attempt++ {
		if err := c.waitRate(ctx); err != nil {
			return err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "application/json")

		res, err := c.http.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("%w: %v", musiccatalog.ErrFetchFailed, err)
			if !sleepBackoff(ctx, attempt) {
				return lastErr
			}
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(res.Body, 8<<20))
		res.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("%w: read body", musiccatalog.ErrFetchFailed)
			if !sleepBackoff(ctx, attempt) {
				return lastErr
			}
			continue
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
			lastErr = musiccatalog.ErrRateLimited
			if !sleepBackoff(ctx, attempt) {
				return lastErr
			}
			continue
		default:
			// MusicBrainz sometimes returns 200-shaped "busy" JSON with non-200 elsewhere.
			if strings.Contains(strings.ToLower(string(body)), "currently busy") {
				lastErr = musiccatalog.ErrRateLimited
				if !sleepBackoff(ctx, attempt) {
					return lastErr
				}
				continue
			}
			return fmt.Errorf("%w: status %d", musiccatalog.ErrFetchFailed, res.StatusCode)
		}
	}
	if lastErr != nil {
		return lastErr
	}
	return musiccatalog.ErrFetchFailed
}

func sleepBackoff(ctx context.Context, attempt int) bool {
	// 1s, 2s, 4s, 8s — MusicBrainz "busy" is usually brief.
	wait := time.Duration(1<<attempt) * time.Second
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
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
