package openlibrary

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	xdraw "golang.org/x/image/draw"
)

const (
	// pixelScaleFactor shrinks each dimension so total pixels become ~10%.
	// sqrt(0.1) ≈ 0.3162 keeps aspect ratio while cutting pixel count to 10%.
	pixelScaleFactor   = 0.316227766
	maxImageCacheSize  = 700 // mirrors book (500) + author (200) capacity
	jpegEncodeQuality  = 80
	maxUpstreamImageMB = 8
)

type cachedImage struct {
	data        []byte
	contentType string
	cachedAt    time.Time
}

type imageKey string

func coverImageKey(coverID int) imageKey {
	return imageKey(fmt.Sprintf("b/id/%d", coverID))
}

func authorPhotoIDKey(photoID int) imageKey {
	return imageKey(fmt.Sprintf("a/id/%d", photoID))
}

func authorOLIDKey(authorID string) imageKey {
	return imageKey(fmt.Sprintf("a/olid/%s", strings.ToUpper(authorID)))
}

func (c *Client) GetCoverImage(ctx context.Context, coverID int) ([]byte, string, error) {
	if coverID <= 0 {
		return nil, "", ErrNotFound
	}
	return c.getOrFetchImage(ctx, coverImageKey(coverID), fmt.Sprintf("%s/b/id/%d-L.jpg", c.coversBase, coverID))
}

func (c *Client) GetAuthorPhotoByID(ctx context.Context, photoID int) ([]byte, string, error) {
	if photoID <= 0 {
		return nil, "", ErrNotFound
	}
	return c.getOrFetchImage(ctx, authorPhotoIDKey(photoID), fmt.Sprintf("%s/a/id/%d-M.jpg", c.coversBase, photoID))
}

func (c *Client) GetAuthorPhotoByOLID(ctx context.Context, authorID string) ([]byte, string, error) {
	id := NormalizeAuthorID(authorID)
	if id == "" {
		return nil, "", fmt.Errorf("%w: invalid author id", ErrBadRequest)
	}
	return c.getOrFetchImage(ctx, authorOLIDKey(id), fmt.Sprintf("%s/a/olid/%s-M.jpg", c.coversBase, id))
}

func (c *Client) getOrFetchImage(ctx context.Context, key imageKey, upstreamURL string) ([]byte, string, error) {
	if cached, ok := c.imageCache.Load(string(key)); ok {
		entry := cached.(cachedImage)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL {
			return entry.data, entry.contentType, nil
		}
	}

	data, contentType, err := c.fetchAndShrinkImage(ctx, upstreamURL)
	if err != nil {
		return nil, "", err
	}
	c.storeImage(string(key), data, contentType)
	return data, contentType, nil
}

func (c *Client) storeImage(key string, data []byte, contentType string) {
	c.imageCache.Store(key, cachedImage{
		data:        data,
		contentType: contentType,
		cachedAt:    c.now(),
	})
	c.evictExpiredImages(c.refreshTTL, maxImageCacheSize)
}

func (c *Client) evictExpiredImages(ttl time.Duration, maxSize int) {
	now := c.now()
	count := 0
	c.imageCache.Range(func(key, value any) bool {
		count++
		entry := value.(cachedImage)
		if now.Sub(entry.cachedAt) >= ttl {
			c.imageCache.Delete(key)
			count--
		}
		return true
	})

	if count <= maxSize {
		return
	}

	type aged struct {
		key any
		at  time.Time
	}
	oldest := make([]aged, 0, count)
	c.imageCache.Range(func(key, value any) bool {
		entry := value.(cachedImage)
		oldest = append(oldest, aged{key: key, at: entry.cachedAt})
		return true
	})

	for i := 0; i < len(oldest); i++ {
		for j := i + 1; j < len(oldest); j++ {
			if oldest[j].at.Before(oldest[i].at) {
				oldest[i], oldest[j] = oldest[j], oldest[i]
			}
		}
	}

	overflow := count - maxSize
	for i := 0; i < overflow && i < len(oldest); i++ {
		c.imageCache.Delete(oldest[i].key)
	}
}

func (c *Client) fetchAndShrinkImage(ctx context.Context, upstreamURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "image/jpeg,image/png,image/*")

	res, err := c.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusNotFound {
		return nil, "", ErrNotFound
	}
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("%w: unexpected status %d", ErrFetchFailed, res.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(res.Body, maxUpstreamImageMB<<20))
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	if len(raw) == 0 {
		return nil, "", ErrNotFound
	}

	shrunk, err := shrinkToTenPercentPixels(raw)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	return shrunk, "image/jpeg", nil
}

func shrinkToTenPercentPixels(raw []byte) ([]byte, error) {
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

	newWidth := int(math.Round(float64(width) * pixelScaleFactor))
	newHeight := int(math.Round(float64(height) * pixelScaleFactor))
	if newWidth < 1 {
		newWidth = 1
	}
	if newHeight < 1 {
		newHeight = 1
	}

	// Already at or below target pixel count — re-encode for consistent JPEG output.
	if newWidth >= width && newHeight >= height {
		return encodeJPEG(src)
	}

	dst := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, xdraw.Over, nil)
	return encodeJPEG(dst)
}

func encodeJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegEncodeQuality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (c *Client) warmImages(ctx context.Context, books []Book, authors []AuthorSummary) {
	seen := make(map[string]struct{})
	var keys []struct {
		key imageKey
		url string
	}

	for _, book := range books {
		if id := coverIDFromProxyURL(book.CoverURL, c.coverPublicBase); id > 0 {
			key := coverImageKey(id)
			if _, ok := seen[string(key)]; ok {
				continue
			}
			seen[string(key)] = struct{}{}
			keys = append(keys, struct {
				key imageKey
				url string
			}{key: key, url: fmt.Sprintf("%s/b/id/%d-L.jpg", c.coversBase, id)})
		}
	}

	for _, author := range authors {
		if key, upstream, ok := authorImageFromProxyURL(author.PhotoURL, c.coverPublicBase, c.coversBase); ok {
			if _, exists := seen[string(key)]; exists {
				continue
			}
			seen[string(key)] = struct{}{}
			keys = append(keys, struct {
				key imageKey
				url string
			}{key: key, url: upstream})
		}
	}

	for _, item := range keys {
		if ctx.Err() != nil {
			return
		}
		if cached, ok := c.imageCache.Load(string(item.key)); ok {
			entry := cached.(cachedImage)
			if c.now().Sub(entry.cachedAt) < c.refreshTTL {
				continue
			}
		}
		_, _, _ = c.getOrFetchImage(ctx, item.key, item.url)
	}
}

func coverIDFromProxyURL(coverURL, publicBase string) int {
	prefix := strings.TrimRight(publicBase, "/") + "/b/id/"
	if !strings.HasPrefix(coverURL, prefix) {
		return 0
	}
	rest := strings.TrimPrefix(coverURL, prefix)
	rest = strings.TrimSuffix(rest, ".jpg")
	var id int
	if _, err := fmt.Sscanf(rest, "%d", &id); err != nil {
		return 0
	}
	return id
}

func authorImageFromProxyURL(photoURL, publicBase, coversBase string) (imageKey, string, bool) {
	base := strings.TrimRight(publicBase, "/")
	if strings.HasPrefix(photoURL, base+"/a/id/") {
		rest := strings.TrimPrefix(photoURL, base+"/a/id/")
		rest = strings.TrimSuffix(rest, ".jpg")
		var id int
		if _, err := fmt.Sscanf(rest, "%d", &id); err != nil || id <= 0 {
			return "", "", false
		}
		return authorPhotoIDKey(id), fmt.Sprintf("%s/a/id/%d-M.jpg", coversBase, id), true
	}
	if strings.HasPrefix(photoURL, base+"/a/olid/") {
		rest := strings.TrimPrefix(photoURL, base+"/a/olid/")
		rest = strings.TrimSuffix(rest, ".jpg")
		id := NormalizeAuthorID(rest)
		if id == "" {
			return "", "", false
		}
		return authorOLIDKey(id), fmt.Sprintf("%s/a/olid/%s-M.jpg", coversBase, id), true
	}
	return "", "", false
}

// WarmImagesAsync fetches and shrinks covers/photos in the background.
func (c *Client) WarmImagesAsync(parent context.Context, books []Book, authors []AuthorSummary) {
	booksCopy := append([]Book(nil), books...)
	authorsCopy := append([]AuthorSummary(nil), authors...)
	go func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 10*time.Minute)
		defer cancel()
		c.warmImages(ctx, booksCopy, authorsCopy)
	}()
}
