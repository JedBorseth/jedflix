package musicbrainz

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz/local"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
	xdraw "golang.org/x/image/draw"
)

const (
	artworkPixelScale     = 0.316227766 // ~10% pixels (matches Open Library)
	artworkJPEGQuality    = 80
	maxUpstreamArtworkMB  = 8
	artworkMissingTTL     = 6 * time.Hour
	maxArtworkMemCache    = 400
	artworkWarmTimeout    = 10 * time.Minute
	minCoverFetchInterval = 600 * time.Millisecond
)

type cachedArtwork struct {
	data        []byte
	contentType string
	cachedAt    time.Time
}

// GetReleaseGroupCover returns optimized JPEG bytes for a release-group MBID.
// Images are fetched lazily from Cover Art Archive and cached permanently on disk.
func (c *Client) GetReleaseGroupCover(ctx context.Context, releaseGroupID string) ([]byte, string, error) {
	releaseGroupID = NormalizeMBID(releaseGroupID)
	if releaseGroupID == "" {
		return nil, "", musiccatalog.ErrBadRequest
	}
	return c.getOrFetchArtwork(ctx, releaseGroupID)
}

func (c *Client) getOrFetchArtwork(ctx context.Context, mbid string) ([]byte, string, error) {
	if cached, ok := c.artworkMem.Load(mbid); ok {
		entry := cached.(cachedArtwork)
		return entry.data, entry.contentType, nil
	}

	if data, contentType, ok := c.readArtworkFromDisk(mbid); ok {
		c.storeArtworkMem(mbid, data, contentType)
		return data, contentType, nil
	}

	if c.isArtworkMissing(mbid) {
		return nil, "", musiccatalog.ErrNotFound
	}

	value, err, _ := c.artworkFetch.Do("release:"+mbid, func() (any, error) {
		if cached, ok := c.artworkMem.Load(mbid); ok {
			return cached.(cachedArtwork), nil
		}
		if data, contentType, ok := c.readArtworkFromDisk(mbid); ok {
			entry := cachedArtwork{data: data, contentType: contentType, cachedAt: c.now()}
			c.storeArtworkMem(mbid, data, contentType)
			return entry, nil
		}
		if c.isArtworkMissing(mbid) {
			return nil, musiccatalog.ErrNotFound
		}

		data, contentType, sourceURL, err := c.fetchReleaseArtwork(ctx, mbid)
		if err != nil {
			if errors.Is(err, musiccatalog.ErrNotFound) {
				c.markArtworkMissing(mbid)
			}
			return nil, err
		}
		if err := c.writeArtworkToDisk(mbid, data); err != nil {
			// Still serve the shrunk image even if disk write fails.
			fmt.Printf("music artwork disk write failed for %s: %v\n", mbid, err)
		}
		c.storeArtworkMem(mbid, data, contentType)
		c.rememberArtworkURL(ctx, mbid, local.ArtworkKindReleaseGroup, sourceURL, "")
		return cachedArtwork{data: data, contentType: contentType, cachedAt: c.now()}, nil
	})
	if err != nil {
		return nil, "", err
	}
	entry := value.(cachedArtwork)
	return entry.data, entry.contentType, nil
}

// Last.fm album MBIDs are often MusicBrainz *release* IDs, while homepage
// cover URLs always go through /release-group/{mbid}. Try both CAA endpoints.
func (c *Client) fetchReleaseArtwork(ctx context.Context, mbid string) ([]byte, string, string, error) {
	base := strings.TrimRight(c.coverBase, "/")
	urls := []string{
		base + "/release-group/" + mbid + "/front-500",
		base + "/release/" + mbid + "/front-500",
	}
	var lastErr error
	for _, upstream := range urls {
		data, contentType, err := c.fetchAndShrinkArtwork(ctx, upstream)
		if err == nil {
			return data, contentType, upstream, nil
		}
		lastErr = err
		if errors.Is(err, musiccatalog.ErrRateLimited) || ctx.Err() != nil {
			return nil, "", "", err
		}
		if !errors.Is(err, musiccatalog.ErrNotFound) {
			return nil, "", "", err
		}
	}
	if lastErr == nil {
		lastErr = musiccatalog.ErrNotFound
	}
	return nil, "", "", lastErr
}

func (c *Client) fetchAndShrinkArtwork(ctx context.Context, upstreamURL string) ([]byte, string, error) {
	if err := c.waitCoverFetch(ctx, upstreamURL); err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", musiccatalog.ErrFetchFailed, err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "image/jpeg,image/png,image/*")

	res, err := c.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer res.Body.Close()

	switch res.StatusCode {
	case http.StatusOK:
		// continue
	case http.StatusNotFound:
		return nil, "", musiccatalog.ErrNotFound
	case http.StatusTooManyRequests, http.StatusServiceUnavailable:
		return nil, "", musiccatalog.ErrRateLimited
	default:
		return nil, "", fmt.Errorf("%w: status %d", musiccatalog.ErrFetchFailed, res.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(res.Body, maxUpstreamArtworkMB<<20))
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", musiccatalog.ErrFetchFailed, err)
	}
	if len(raw) == 0 {
		return nil, "", musiccatalog.ErrNotFound
	}

	shrunk, err := shrinkArtwork(raw)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", musiccatalog.ErrFetchFailed, err)
	}
	return shrunk, "image/jpeg", nil
}

func (c *Client) waitCoverFetch(ctx context.Context, upstreamURL string) error {
	if !c.isCoverArchiveURL(upstreamURL) {
		return nil
	}
	c.coverRateMu.Lock()
	defer c.coverRateMu.Unlock()
	elapsed := c.now().Sub(c.lastCoverReq)
	if elapsed < minCoverFetchInterval {
		timer := time.NewTimer(minCoverFetchInterval - elapsed)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
	}
	c.lastCoverReq = c.now()
	return nil
}

func (c *Client) isCoverArchiveURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return false
	}
	coverBase, err := url.Parse(strings.TrimRight(c.coverBase, "/"))
	if err == nil && coverBase.Host != "" && strings.EqualFold(parsed.Host, coverBase.Host) {
		return true
	}
	return strings.Contains(strings.ToLower(parsed.Host), "coverartarchive.org")
}

func shrinkArtwork(raw []byte) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	bounds := src.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("invalid image dimensions")
	}

	newWidth := int(math.Round(float64(width) * artworkPixelScale))
	newHeight := int(math.Round(float64(height) * artworkPixelScale))
	if newWidth < 1 {
		newWidth = 1
	}
	if newHeight < 1 {
		newHeight = 1
	}
	if newWidth >= width && newHeight >= height {
		return encodeArtworkJPEG(src)
	}
	dst := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, xdraw.Over, nil)
	return encodeArtworkJPEG(dst)
}

func encodeArtworkJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: artworkJPEGQuality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (c *Client) artworkDirReady() bool {
	return strings.TrimSpace(c.artworkPath) != ""
}

func (c *Client) mbidPath(mbid string) string {
	return filepath.Join(c.artworkPath, "by-mbid", mbid+".jpg")
}

func (c *Client) missingPath(mbid string) string {
	// v2: we now try both CAA release-group and release endpoints. Older
	// markers treated Last.fm release MBIDs as permanently cover-less.
	return filepath.Join(c.artworkPath, "missing", mbid+".v2")
}

func (c *Client) hashPath(sum string) string {
	return filepath.Join(c.artworkPath, "by-hash", sum[:2], sum+".jpg")
}

func (c *Client) readArtworkFromDisk(mbid string) ([]byte, string, bool) {
	if !c.artworkDirReady() {
		return nil, "", false
	}
	path := c.mbidPath(mbid)
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		// Follow content-addressed link map: by-mbid may be a tiny pointer file.
		if pointer, err := os.ReadFile(path + ".hash"); err == nil {
			sum := strings.TrimSpace(string(pointer))
			if len(sum) == 64 {
				if hashed, err := os.ReadFile(c.hashPath(sum)); err == nil && len(hashed) > 0 {
					return hashed, "image/jpeg", true
				}
			}
		}
		return nil, "", false
	}
	return data, "image/jpeg", true
}

func (c *Client) writeArtworkToDisk(mbid string, data []byte) error {
	if !c.artworkDirReady() {
		return nil
	}
	if err := os.MkdirAll(filepath.Join(c.artworkPath, "by-mbid"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(c.artworkPath, "by-hash"), 0o755); err != nil {
		return err
	}

	sumBytes := sha256.Sum256(data)
	sum := hex.EncodeToString(sumBytes[:])
	hashFile := c.hashPath(sum)
	if err := os.MkdirAll(filepath.Dir(hashFile), 0o755); err != nil {
		return err
	}

	c.artworkDiskMu.Lock()
	defer c.artworkDiskMu.Unlock()

	if _, err := os.Stat(hashFile); errors.Is(err, os.ErrNotExist) {
		tmp := hashFile + ".tmp"
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			return err
		}
		if err := os.Rename(tmp, hashFile); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}

	// Deduplicate: mbid points at content hash; also keep a direct copy for fast serving.
	pointer := c.mbidPath(mbid) + ".hash"
	if err := os.WriteFile(pointer, []byte(sum+"\n"), 0o644); err != nil {
		return err
	}
	// Hard-link or copy into by-mbid for simple static serving without extra lookup.
	mbidFile := c.mbidPath(mbid)
	_ = os.Remove(mbidFile)
	if err := os.Link(hashFile, mbidFile); err != nil {
		// Cross-device or unsupported — fall back to a copy.
		return copyFile(hashFile, mbidFile)
	}
	_ = os.Remove(c.missingPath(mbid))
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, in, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

func (c *Client) isArtworkMissing(mbid string) bool {
	if !c.artworkDirReady() {
		return false
	}
	info, err := os.Stat(c.missingPath(mbid))
	if err != nil {
		return false
	}
	if c.now().Sub(info.ModTime()) > artworkMissingTTL {
		_ = os.Remove(c.missingPath(mbid))
		return false
	}
	return true
}

func (c *Client) markArtworkMissing(mbid string) {
	if !c.artworkDirReady() {
		return
	}
	_ = os.MkdirAll(filepath.Join(c.artworkPath, "missing"), 0o755)
	_ = os.WriteFile(c.missingPath(mbid), []byte(c.now().UTC().Format(time.RFC3339)+"\n"), 0o644)
}

func (c *Client) storeArtworkMem(mbid string, data []byte, contentType string) {
	c.artworkMem.Store(mbid, cachedArtwork{
		data:        data,
		contentType: contentType,
		cachedAt:    c.now(),
	})
	c.evictArtworkMem()
}

func (c *Client) evictArtworkMem() {
	count := 0
	c.artworkMem.Range(func(_, _ any) bool {
		count++
		return true
	})
	if count <= maxArtworkMemCache {
		return
	}
	type aged struct {
		key any
		at  time.Time
	}
	items := make([]aged, 0, count)
	c.artworkMem.Range(func(key, value any) bool {
		items = append(items, aged{key: key, at: value.(cachedArtwork).cachedAt})
		return true
	})
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].at.Before(items[i].at) {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
	overflow := count - maxArtworkMemCache
	for i := 0; i < overflow && i < len(items); i++ {
		c.artworkMem.Delete(items[i].key)
	}
}

// WarmArtworkAsync prefetches release-group and artist covers in the background.
func (c *Client) WarmArtworkAsync(parent context.Context, albums []musiccatalog.Album, tracks []musiccatalog.TopTrack, artists []musiccatalog.Artist) {
	ids := make([]string, 0, len(albums)+len(tracks))
	seen := map[string]struct{}{}
	add := func(id string) {
		id = NormalizeMBID(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for _, a := range albums {
		add(a.ID)
	}
	for _, t := range tracks {
		add(t.AlbumID)
	}
	artistIDs := make([]string, 0, len(artists))
	artistSeen := map[string]struct{}{}
	for _, artist := range artists {
		id := NormalizeMBID(artist.ID)
		if id == "" {
			continue
		}
		if _, ok := artistSeen[id]; ok {
			continue
		}
		artistSeen[id] = struct{}{}
		artistIDs = append(artistIDs, id)
	}
	if len(ids) == 0 && len(artistIDs) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), artworkWarmTimeout)
		defer cancel()
		var wg sync.WaitGroup
		sem := make(chan struct{}, 2)
		for _, id := range ids {
			if ctx.Err() != nil {
				break
			}
			id := id
			wg.Add(1)
			sem <- struct{}{}
			go func() {
				defer wg.Done()
				defer func() { <-sem }()
				_, _, _ = c.getOrFetchArtwork(ctx, id)
			}()
		}
		for _, id := range artistIDs {
			if ctx.Err() != nil {
				break
			}
			id := id
			wg.Add(1)
			sem <- struct{}{}
			go func() {
				defer wg.Done()
				defer func() { <-sem }()
				_, _, _ = c.GetArtistCover(ctx, id)
			}()
		}
		wg.Wait()
	}()
}

// coverURL returns the public proxy URL for release-group artwork (Open Library pattern).
func (c *Client) coverURL(releaseGroupID string) string {
	if releaseGroupID == "" {
		return fallbackImage
	}
	base := strings.TrimRight(c.coverPublicBase, "/")
	if base == "" {
		base = "/backend/api/v1/music/covers"
	}
	return base + "/release-group/" + releaseGroupID + ".jpg"
}

func artistCacheKey(artistID string) string {
	return "artist-" + artistID
}

// artistCoverURL returns the public proxy URL for an artist image.
// The handler lazy-loads Wikimedia (MusicBrainz URL rel) or a studio-album cover.
func (c *Client) artistCoverURL(artistID string) string {
	if artistID == "" {
		return fallbackImage
	}
	base := strings.TrimRight(c.coverPublicBase, "/")
	if base == "" {
		base = "/backend/api/v1/music/covers"
	}
	return base + "/artist/" + artistID + ".jpg"
}

func usableImageURL(raw string) bool {
	url := strings.TrimSpace(raw)
	if url == "" {
		return false
	}
	lower := strings.ToLower(url)
	if strings.Contains(lower, "placehold.co") {
		return false
	}
	// Last.fm retired artist images; this hash is the default gray star.
	if strings.Contains(lower, "2a96cbd8b46e442fc41c2b86b821562f") {
		return false
	}
	return true
}

// GetArtistCover returns optimized JPEG bytes for an artist MBID.
func (c *Client) GetArtistCover(ctx context.Context, artistID string) ([]byte, string, error) {
	artistID = NormalizeMBID(artistID)
	if artistID == "" {
		return nil, "", musiccatalog.ErrBadRequest
	}
	key := artistCacheKey(artistID)
	if cached, ok := c.artworkMem.Load(key); ok {
		entry := cached.(cachedArtwork)
		return entry.data, entry.contentType, nil
	}
	if data, contentType, ok := c.readArtworkFromDisk(key); ok {
		c.storeArtworkMem(key, data, contentType)
		return data, contentType, nil
	}
	if c.isArtworkMissing(key) {
		return nil, "", musiccatalog.ErrNotFound
	}

	value, err, _ := c.artworkFetch.Do(key, func() (any, error) {
		if cached, ok := c.artworkMem.Load(key); ok {
			return cached.(cachedArtwork), nil
		}
		if data, contentType, ok := c.readArtworkFromDisk(key); ok {
			entry := cachedArtwork{data: data, contentType: contentType, cachedAt: c.now()}
			c.storeArtworkMem(key, data, contentType)
			return entry, nil
		}
		if c.isArtworkMissing(key) {
			return nil, musiccatalog.ErrNotFound
		}

		data, contentType, err := c.resolveArtistArtwork(ctx, artistID)
		if err != nil {
			if errors.Is(err, musiccatalog.ErrNotFound) {
				c.markArtworkMissing(key)
			}
			return nil, err
		}
		if err := c.writeArtworkToDisk(key, data); err != nil {
			fmt.Printf("music artist artwork disk write failed for %s: %v\n", artistID, err)
		}
		c.storeArtworkMem(key, data, contentType)
		return cachedArtwork{data: data, contentType: contentType, cachedAt: c.now()}, nil
	})
	if err != nil {
		return nil, "", err
	}
	entry := value.(cachedArtwork)
	return entry.data, entry.contentType, nil
}

func (c *Client) resolveArtistArtwork(ctx context.Context, artistID string) ([]byte, string, error) {
	if c.useLocalStore() {
		if stored, err := c.local.GetArtwork(ctx, artistID); err == nil && stored != nil && strings.TrimSpace(stored.SourceURL) != "" {
			data, contentType, fetchErr := c.fetchAndShrinkArtwork(ctx, wikimediaFilePath(stored.SourceURL))
			if fetchErr == nil {
				return data, contentType, nil
			}
		}
		if raw, err := c.local.ArtistImageURL(ctx, artistID); err == nil && strings.TrimSpace(raw) != "" {
			source := wikimediaFilePath(raw)
			data, contentType, fetchErr := c.fetchAndShrinkArtwork(ctx, source)
			if fetchErr == nil {
				c.rememberArtworkURL(ctx, artistID, local.ArtworkKindArtist, source, "")
				return data, contentType, nil
			}
		}
		if albums, err := c.local.PreferredArtistAlbums(ctx, artistID, 5); err == nil {
			if data, contentType, albumID, ok := c.firstAlbumArtwork(ctx, albums); ok {
				c.rememberArtworkURL(ctx, artistID, local.ArtworkKindArtist, c.caaFrontURL(albumID), albumID)
				return data, contentType, nil
			}
		}
	}

	return nil, "", musiccatalog.ErrNotFound
}

func (c *Client) rememberArtworkURL(ctx context.Context, mbid, kind, sourceURL, albumMBID string) {
	if !c.useLocalStore() || strings.TrimSpace(sourceURL) == "" {
		return
	}
	if err := c.local.UpsertArtwork(ctx, local.Artwork{
		MBID:      mbid,
		Kind:      kind,
		SourceURL: sourceURL,
		AlbumMBID: albumMBID,
	}); err != nil {
		fmt.Printf("jedflix artwork store failed for %s: %v\n", mbid, err)
	}
}

func (c *Client) caaFrontURL(releaseGroupID string) string {
	releaseGroupID = NormalizeMBID(releaseGroupID)
	if releaseGroupID == "" {
		return ""
	}
	return strings.TrimRight(c.coverBase, "/") + "/release-group/" + releaseGroupID + "/front-500"
}

func (c *Client) firstAlbumArtwork(ctx context.Context, albumIDs []string) ([]byte, string, string, bool) {
	for _, id := range albumIDs {
		if ctx.Err() != nil {
			return nil, "", "", false
		}
		id = NormalizeMBID(id)
		if id == "" {
			continue
		}
		data, contentType, err := c.getOrFetchArtwork(ctx, id)
		if err == nil && len(data) > 0 {
			c.rememberArtworkURL(ctx, id, local.ArtworkKindReleaseGroup, c.caaFrontURL(id), "")
			return data, contentType, id, true
		}
	}
	return nil, "", "", false
}

// wikimediaFilePath turns a Commons File: page into a direct image URL.
func wikimediaFilePath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return raw
	}
	host := strings.ToLower(parsed.Host)
	path := parsed.EscapedPath()
	lowerPath := strings.ToLower(path)
	isWiki := strings.Contains(host, "wikimedia.org") || strings.Contains(host, "wikipedia.org")
	if !isWiki {
		return raw
	}
	if strings.Contains(lowerPath, "special:filepath") {
		query := parsed.Query()
		if query.Get("width") == "" {
			query.Set("width", "500")
			parsed.RawQuery = query.Encode()
		}
		return parsed.String()
	}
	fileIdx := strings.Index(lowerPath, "file:")
	if fileIdx < 0 {
		return raw
	}
	name := path[fileIdx+len("file:"):]
	name = strings.ReplaceAll(name, " ", "_")
	if name == "" {
		return raw
	}
	return "https://commons.wikimedia.org/wiki/Special:FilePath/" + name + "?width=500"
}
