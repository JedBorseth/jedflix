package musicbrainz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func TestLoadPersistedCatalogAcceptsOlderVersions(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "music-catalog.json")

	payload := persistedCatalog{
		Version:  2,
		Provider: "musicbrainz",
		SavedAt:  time.Now().UnixMilli(),
		Browse: musiccatalog.BrowseResponse{
			Rows: []musiccatalog.CatalogRow{{
				Title: "Popular Pop Artists",
				Key:   "pop-artists",
				Kind:  "artists",
				Artists: []musiccatalog.Artist{{
					ID:   "a74b1b7f-71a5-4011-9441-d0b5e4122711",
					Name: "Cached Artist",
				}},
			}},
		},
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	client := NewClient(configForTest(path))
	if !client.loadPersistedCatalog() {
		t.Fatal("expected v2 catalog to load")
	}
	browse, err := client.Browse(t.Context())
	if err != nil {
		t.Fatalf("Browse: %v", err)
	}
	if len(browse.Rows) != 1 || browse.Rows[0].Artists[0].Name != "Cached Artist" {
		t.Fatalf("browse = %#v", browse.Rows)
	}
}

func configForTest(catalogPath string) config.Config {
	return config.Config{MusicCatalogPath: catalogPath}
}
