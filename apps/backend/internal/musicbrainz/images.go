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
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
	xdraw "golang.org/x/image/draw"
)

const (
	artworkPixelScale     = 0.316227766 // ~10% pixels (matches Open Library)
	artworkJPEGQuality    = 80
	maxUpstreamArtworkMB  = 8
	artworkMissingTTL     = 30 * 24 * time.Hour
	maxArtworkMemCache    = 400
	artworkWarmTimeout    = 10 * time.Minute
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

	upstream := strings.TrimRight(c.coverBase, "/") + "/release-group/" + mbid + "/front-500"
	data, contentType, err := c.fetchAndShrinkArtwork(ctx, upstream)
	if err != nil {
		if errors.Is(err, musiccatalog.ErrNotFound) {
			c.markArtworkMissing(mbid)
		}
		return nil, "", err
	}
	if err := c.writeArtworkToDisk(mbid, data); err != nil {
		// Still serve the shrunk image even if disk write fails.
		fmt.Printf("music artwork disk write failed for %s: %v\n", mbid, err)
	}
	c.storeArtworkMem(mbid, data, contentType)
	return data, contentType, nil
}

func (c *Client) fetchAndShrinkArtwork(ctx context.Context, upstreamURL string) ([]byte, string, error) {
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
	case http.StatusNotFound, http.StatusBadRequest:
		return nil, "", musiccatalog.ErrNotFound
	default:
		// CAA returns 404-ish via redirects sometimes; treat other errors as fetch failures.
		if res.StatusCode >= 400 && res.StatusCode < 500 {
			return nil, "", musiccatalog.ErrNotFound
		}
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
	return filepath.Join(c.artworkPath, "missing", mbid)
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

// WarmArtworkAsync prefetches release-group covers in the background (browse/search).
func (c *Client) WarmArtworkAsync(parent context.Context, albums []musiccatalog.Album, tracks []musiccatalog.TopTrack) {
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
	if len(ids) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), artworkWarmTimeout)
		defer cancel()
		var wg sync.WaitGroup
		sem := make(chan struct{}, 4)
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
