package spotify

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

const catalogFileVersion = 1

type persistedCatalog struct {
	Version int            `json:"version"`
	SavedAt int64          `json:"savedAt"`
	Browse  BrowseResponse `json:"browse"`
}

func (c *Client) loadPersistedCatalog() bool {
	path := stringsTrim(c.catalogPath)
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
	if file.Version != catalogFileVersion {
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

func (c *Client) savePersistedCatalog(browse *BrowseResponse) {
	path := stringsTrim(c.catalogPath)
	if path == "" || browse == nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	payload := persistedCatalog{
		Version: catalogFileVersion,
		SavedAt: c.now().UnixMilli(),
		Browse:  *browse,
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

func (c *Client) applyCatalog(response *BrowseResponse) {
	if response == nil {
		return
	}
	for _, album := range response.NewReleases {
		c.rememberAlbumSummary(album)
		for i, artistID := range album.ArtistIDs {
			name := ""
			if i < len(album.Artists) {
				name = album.Artists[i]
			}
			if artistID != "" && name != "" {
				c.rememberArtistSummary(Artist{ID: artistID, Name: name, ImageURL: album.ImageURL, Genres: []string{}})
			}
		}
	}
	for _, row := range response.Rows {
		for _, album := range row.Albums {
			c.rememberAlbumSummary(album)
			for i, artistID := range album.ArtistIDs {
				name := ""
				if i < len(album.Artists) {
					name = album.Artists[i]
				}
				if artistID != "" && name != "" {
					c.rememberArtistSummary(Artist{ID: artistID, Name: name, ImageURL: album.ImageURL, Genres: []string{}})
				}
			}
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

func (c *Client) hasCatalog() bool {
	c.catalogMu.RLock()
	defer c.catalogMu.RUnlock()
	return c.catalog != nil
}

func stringsTrim(value string) string {
	for len(value) > 0 && (value[0] == ' ' || value[0] == '\t') {
		value = value[1:]
	}
	for len(value) > 0 && (value[len(value)-1] == ' ' || value[len(value)-1] == '\t') {
		value = value[:len(value)-1]
	}
	return value
}
