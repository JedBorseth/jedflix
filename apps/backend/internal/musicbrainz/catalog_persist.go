package musicbrainz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

const catalogFileVersion = 2

type persistedCatalog struct {
	Version  int                         `json:"version"`
	Provider string                      `json:"provider"`
	SavedAt  int64                       `json:"savedAt"`
	Browse   musiccatalog.BrowseResponse `json:"browse"`
}

func (c *Client) loadPersistedCatalog() bool {
	path := strings.TrimSpace(c.catalogPath)
	if path == "" {
		return false
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return false
	}
	var file persistedCatalog
	if err := json.Unmarshal(data, &file); err != nil {
		return false
	}
	if file.Version != catalogFileVersion || file.Provider != "musicbrainz" {
		return false
	}
	if len(file.Browse.Rows) == 0 && len(file.Browse.NewReleases) == 0 {
		return false
	}
	response := file.Browse
	if response.CachedAt == 0 {
		response.CachedAt = file.SavedAt
	}
	c.applyCatalog(&response)
	return true
}

func (c *Client) savePersistedCatalog(browse *musiccatalog.BrowseResponse) {
	path := strings.TrimSpace(c.catalogPath)
	if path == "" || browse == nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	payload := persistedCatalog{
		Version:  catalogFileVersion,
		Provider: "musicbrainz",
		SavedAt:  c.now().UnixMilli(),
		Browse:   *browse,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

func (c *Client) applyCatalog(response *musiccatalog.BrowseResponse) {
	if response == nil {
		return
	}
	for _, album := range response.NewReleases {
		c.rememberAlbumSummary(album)
	}
	for _, row := range response.Rows {
		for _, album := range row.Albums {
			c.rememberAlbumSummary(album)
		}
		for _, artist := range row.Artists {
			c.rememberArtistSummary(artist)
		}
	}
	c.catalogMu.Lock()
	c.catalog = response
	c.refreshErr = nil
	c.catalogMu.Unlock()
}

func (c *Client) catalogAge() time.Duration {
	c.catalogMu.RLock()
	defer c.catalogMu.RUnlock()
	if c.catalog == nil || c.catalog.CachedAt <= 0 {
		return c.refreshTTL + time.Second
	}
	cachedAt := time.UnixMilli(c.catalog.CachedAt)
	age := c.now().Sub(cachedAt)
	if age < 0 {
		return 0
	}
	return age
}
