package youtube

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Proxy streams remote audio to the client without writing files to disk.
// Supports Range / seeking for HTML5 Audio and iOS PWA playback.
func Proxy(w http.ResponseWriter, r *http.Request, info *StreamInfo) error {
	if info == nil || strings.TrimSpace(info.URL) == "" {
		return ErrNotFound
	}

	upstream, err := http.NewRequestWithContext(r.Context(), r.Method, info.URL, nil)
	if err != nil {
		return fmt.Errorf("%w: build upstream: %v", ErrResolveFail, err)
	}

	// Forward range / conditional headers needed for seeking.
	for _, key := range []string{"Range", "If-Range", "If-None-Match", "If-Modified-Since"} {
		if value := r.Header.Get(key); value != "" {
			upstream.Header.Set(key, value)
		}
	}
	upstream.Header.Set("User-Agent", "Mozilla/5.0 (compatible; JedFlix/1.0)")
	upstream.Header.Set("Accept", "*/*")

	client := &http.Client{
		Timeout: 0, // stream until client disconnects
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 8 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}

	resp, err := client.Do(upstream)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return err
		}
		return fmt.Errorf("%w: upstream fetch: %v", ErrResolveFail, err)
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" || strings.HasPrefix(contentType, "application/octet-stream") {
		if info.ContentType != "" {
			contentType = info.ContentType
		}
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}

	copyHeader(w, resp, "Accept-Ranges")
	copyHeader(w, resp, "Content-Length")
	copyHeader(w, resp, "Content-Range")
	copyHeader(w, resp, "ETag")
	copyHeader(w, resp, "Last-Modified")
	copyHeader(w, resp, "Cache-Control")
	if w.Header().Get("Accept-Ranges") == "" {
		w.Header().Set("Accept-Ranges", "bytes")
	}
	w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, Content-Type")

	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)

	if r.Method == http.MethodHead {
		return nil
	}

	_, copyErr := io.Copy(w, resp.Body)
	return copyErr
}

func copyHeader(w http.ResponseWriter, resp *http.Response, key string) {
	if value := resp.Header.Get(key); value != "" {
		w.Header().Set(key, value)
	}
}

// ResolveTimeout is the max time allowed for yt-dlp search + extract.
const ResolveTimeout = 45 * time.Second
