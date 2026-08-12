// Package musicsearch provides Meilisearch-backed local music catalog search.
package musicsearch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
	"github.com/meilisearch/meilisearch-go"
)

const (
	indexArtists       = "mb_artists"
	indexReleaseGroups = "mb_release_groups"
	indexReleases      = "mb_releases"
	indexRecordings    = "mb_recordings"
)

// Client talks to a local Meilisearch instance populated from MusicBrainz.
type Client struct {
	meili meilisearch.ServiceManager
}

func New(url, apiKey string) (*Client, error) {
	url = strings.TrimRight(strings.TrimSpace(url), "/")
	if url == "" {
		return nil, fmt.Errorf("meilisearch url is required")
	}
	opts := []meilisearch.Option{}
	if apiKey != "" {
		opts = append(opts, meilisearch.WithAPIKey(apiKey))
	}
	m := meilisearch.New(url, opts...)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := m.HealthWithContext(ctx); err != nil {
		return nil, fmt.Errorf("meilisearch health: %w", err)
	}
	return &Client{meili: m}, nil
}

func (c *Client) Configured() bool {
	return c != nil && c.meili != nil
}

// EnsureIndexes creates indexes and searchable attributes suitable for
// fuzzy / prefix / typo-tolerant music search.
func (c *Client) EnsureIndexes(ctx context.Context) error {
	specs := []struct {
		uid        string
		primaryKey string
		searchable []string
		filterable []string
		sortable   []string
	}{
		{
			uid: indexArtists, primaryKey: "id",
			searchable: []string{"name", "aliases", "sortName"},
			filterable: []string{"type"},
			sortable:   []string{"name"},
		},
		{
			uid: indexReleaseGroups, primaryKey: "id",
			searchable: []string{"title", "aliases", "artistCredit", "artists"},
			filterable: []string{"primaryType", "artistIds"},
			sortable:   []string{"firstReleaseDate", "title"},
		},
		{
			uid: indexReleases, primaryKey: "id",
			searchable: []string{"title", "aliases", "artistCredit", "artists"},
			filterable: []string{"status", "releaseGroupId"},
			sortable:   []string{"date", "title"},
		},
		{
			uid: indexRecordings, primaryKey: "id",
			searchable: []string{"title", "aliases", "artistCredit", "artists"},
			filterable: []string{"releaseGroupId"},
			sortable:   []string{"title"},
		},
	}

	for _, spec := range specs {
		task, err := c.meili.CreateIndex(&meilisearch.IndexConfig{
			Uid:        spec.uid,
			PrimaryKey: spec.primaryKey,
		})
		if err != nil && !isAlreadyExists(err) {
			return fmt.Errorf("create index %s: %w", spec.uid, err)
		}
		if task != nil {
			if _, err := c.meili.WaitForTaskWithContext(ctx, task.TaskUID, 100*time.Millisecond); err != nil {
				// Index may already exist from a raced create — continue configuring.
				_ = err
			}
		}
		idx := c.meili.Index(spec.uid)
		if _, err := idx.UpdateSearchableAttributes(&spec.searchable); err != nil {
			return fmt.Errorf("searchable %s: %w", spec.uid, err)
		}
		if _, err := idx.UpdateFilterableAttributes(&spec.filterable); err != nil {
			return fmt.Errorf("filterable %s: %w", spec.uid, err)
		}
		if len(spec.sortable) > 0 {
			if _, err := idx.UpdateSortableAttributes(&spec.sortable); err != nil {
				return fmt.Errorf("sortable %s: %w", spec.uid, err)
			}
		}
		// Typo tolerance + prefix search are on by default in Meilisearch.
		typo := meilisearch.TypoTolerance{
			Enabled: true,
			MinWordSizeForTypos: meilisearch.MinWordSizeForTypos{
				OneTypo:  4,
				TwoTypos: 8,
			},
		}
		if _, err := idx.UpdateTypoTolerance(&typo); err != nil {
			return fmt.Errorf("typo %s: %w", spec.uid, err)
		}
	}
	return nil
}

type ArtistDoc struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	SortName string   `json:"sortName,omitempty"`
	Aliases  []string `json:"aliases,omitempty"`
	Type     string   `json:"type,omitempty"`
}

type ReleaseGroupDoc struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Aliases          []string `json:"aliases,omitempty"`
	ArtistCredit     string   `json:"artistCredit,omitempty"`
	Artists          []string `json:"artists,omitempty"`
	ArtistIDs        []string `json:"artistIds,omitempty"`
	PrimaryType      string   `json:"primaryType,omitempty"`
	FirstReleaseDate string   `json:"firstReleaseDate,omitempty"`
}

type ReleaseDoc struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Aliases        []string `json:"aliases,omitempty"`
	ArtistCredit   string   `json:"artistCredit,omitempty"`
	Artists        []string `json:"artists,omitempty"`
	ArtistIDs      []string `json:"artistIds,omitempty"`
	ReleaseGroupID string   `json:"releaseGroupId,omitempty"`
	Status         string   `json:"status,omitempty"`
	Date           string   `json:"date,omitempty"`
}

type RecordingDoc struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Aliases        []string `json:"aliases,omitempty"`
	ArtistCredit   string   `json:"artistCredit,omitempty"`
	Artists        []string `json:"artists,omitempty"`
	ArtistIDs      []string `json:"artistIds,omitempty"`
	Length         int      `json:"length,omitempty"`
	ReleaseGroupID string   `json:"releaseGroupId,omitempty"`
	AlbumName      string   `json:"albumName,omitempty"`
}

func (c *Client) IndexArtists(ctx context.Context, docs []ArtistDoc) error {
	return c.addDocuments(ctx, indexArtists, docs)
}

func (c *Client) IndexReleaseGroups(ctx context.Context, docs []ReleaseGroupDoc) error {
	return c.addDocuments(ctx, indexReleaseGroups, docs)
}

func (c *Client) IndexReleases(ctx context.Context, docs []ReleaseDoc) error {
	return c.addDocuments(ctx, indexReleases, docs)
}

func (c *Client) IndexRecordings(ctx context.Context, docs []RecordingDoc) error {
	return c.addDocuments(ctx, indexRecordings, docs)
}

func (c *Client) addDocuments(ctx context.Context, index string, docs any) error {
	task, err := c.meili.Index(index).AddDocumentsWithContext(ctx, docs)
	if err != nil {
		return err
	}
	_, err = c.meili.WaitForTaskWithContext(ctx, task.TaskUID, 50*time.Millisecond)
	return err
}

// Search runs a multi-index query and maps hits into catalog DTOs.
func (c *Client) Search(ctx context.Context, query string, limit int) (*musiccatalog.SearchResponse, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}

	queries := []*meilisearch.SearchRequest{
		{IndexUID: indexArtists, Query: query, Limit: int64(limit)},
		{IndexUID: indexReleaseGroups, Query: query, Limit: int64(limit)},
		{IndexUID: indexReleases, Query: query, Limit: int64(limit)},
		{IndexUID: indexRecordings, Query: query, Limit: int64(limit)},
	}
	raw, err := c.meili.MultiSearchWithContext(ctx, &meilisearch.MultiSearchRequest{Queries: queries})
	if err != nil {
		return nil, fmt.Errorf("%w: meilisearch: %v", musiccatalog.ErrFetchFailed, err)
	}

	out := &musiccatalog.SearchResponse{
		Artists: []musiccatalog.Artist{},
		Albums:  []musiccatalog.Album{},
		Tracks:  []musiccatalog.TopTrack{},
	}
	seenAlbums := map[string]struct{}{}

	for _, result := range raw.Results {
		switch result.IndexUID {
		case indexArtists:
			for _, hit := range result.Hits {
				var doc ArtistDoc
				if err := decodeHit(hit, &doc); err != nil || doc.ID == "" {
					continue
				}
				out.Artists = append(out.Artists, musiccatalog.Artist{
					ID:     doc.ID,
					Name:   doc.Name,
					Genres: []string{},
				})
			}
		case indexReleaseGroups:
			for _, hit := range result.Hits {
				var doc ReleaseGroupDoc
				if err := decodeHit(hit, &doc); err != nil || doc.ID == "" {
					continue
				}
				if _, ok := seenAlbums[doc.ID]; ok {
					continue
				}
				seenAlbums[doc.ID] = struct{}{}
				year := yearFromDate(doc.FirstReleaseDate)
				out.Albums = append(out.Albums, musiccatalog.Album{
					ID:          doc.ID,
					Name:        doc.Title,
					Artists:     doc.Artists,
					ArtistIDs:   doc.ArtistIDs,
					ReleaseDate: doc.FirstReleaseDate,
					Year:        year,
					AlbumType:   mapPrimaryType(doc.PrimaryType),
					Genres:      []string{},
				})
			}
		case indexReleases:
			// Surface releases as albums keyed by release-group when possible.
			for _, hit := range result.Hits {
				var doc ReleaseDoc
				if err := decodeHit(hit, &doc); err != nil {
					continue
				}
				albumID := doc.ReleaseGroupID
				if albumID == "" {
					albumID = doc.ID
				}
				if _, ok := seenAlbums[albumID]; ok {
					continue
				}
				seenAlbums[albumID] = struct{}{}
				year := yearFromDate(doc.Date)
				out.Albums = append(out.Albums, musiccatalog.Album{
					ID:          albumID,
					Name:        doc.Title,
					Artists:     doc.Artists,
					ArtistIDs:   doc.ArtistIDs,
					ReleaseDate: doc.Date,
					Year:        year,
					AlbumType:   "album",
					Genres:      []string{},
				})
			}
		case indexRecordings:
			for _, hit := range result.Hits {
				var doc RecordingDoc
				if err := decodeHit(hit, &doc); err != nil || doc.ID == "" {
					continue
				}
				out.Tracks = append(out.Tracks, musiccatalog.TopTrack{
					ID:         doc.ID,
					Name:       doc.Title,
					Artists:    doc.Artists,
					ArtistIDs:  doc.ArtistIDs,
					DurationMs: doc.Length,
					AlbumID:    doc.ReleaseGroupID,
					AlbumName:  doc.AlbumName,
				})
			}
		}
	}

	return out, nil
}

// SearchArtists is a single-index helper used by browse/genre shelves.
func (c *Client) SearchArtists(ctx context.Context, query string, limit int) ([]musiccatalog.Artist, error) {
	res, err := c.searchIndex(ctx, indexArtists, query, limit, "")
	if err != nil {
		return nil, err
	}
	out := make([]musiccatalog.Artist, 0, len(res))
	for _, hit := range res {
		var doc ArtistDoc
		if err := decodeHit(hit, &doc); err != nil || doc.ID == "" {
			continue
		}
		out = append(out, musiccatalog.Artist{ID: doc.ID, Name: doc.Name, Genres: []string{}})
	}
	return out, nil
}

// SearchReleaseGroups filters by primary type when filter is non-empty (e.g. `primaryType = Album`).
func (c *Client) SearchReleaseGroups(ctx context.Context, query, filter string, limit int) ([]musiccatalog.Album, error) {
	res, err := c.searchIndex(ctx, indexReleaseGroups, query, limit, filter)
	if err != nil {
		return nil, err
	}
	out := make([]musiccatalog.Album, 0, len(res))
	for _, hit := range res {
		var doc ReleaseGroupDoc
		if err := decodeHit(hit, &doc); err != nil || doc.ID == "" {
			continue
		}
		out = append(out, musiccatalog.Album{
			ID:          doc.ID,
			Name:        doc.Title,
			Artists:     doc.Artists,
			ArtistIDs:   doc.ArtistIDs,
			ReleaseDate: doc.FirstReleaseDate,
			Year:        yearFromDate(doc.FirstReleaseDate),
			AlbumType:   mapPrimaryType(doc.PrimaryType),
			Genres:      []string{},
		})
	}
	return out, nil
}

// PreferredAlbumsForArtist returns studio-album release-group IDs credited to artistID.
func (c *Client) PreferredAlbumsForArtist(ctx context.Context, artistID string, limit int) ([]string, error) {
	artistID = strings.ToLower(strings.TrimSpace(artistID))
	if artistID == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 5
	}
	filter := fmt.Sprintf(`artistIds = "%s" AND primaryType = "Album"`, artistID)
	albums, err := c.SearchReleaseGroups(ctx, "", filter, limit)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(albums))
	for _, album := range albums {
		if album.ID == "" {
			continue
		}
		ids = append(ids, album.ID)
	}
	return ids, nil
}

func (c *Client) SearchRecordings(ctx context.Context, query string, limit int) ([]musiccatalog.TopTrack, error) {
	res, err := c.searchIndex(ctx, indexRecordings, query, limit, "")
	if err != nil {
		return nil, err
	}
	out := make([]musiccatalog.TopTrack, 0, len(res))
	for _, hit := range res {
		var doc RecordingDoc
		if err := decodeHit(hit, &doc); err != nil || doc.ID == "" {
			continue
		}
		out = append(out, musiccatalog.TopTrack{
			ID:         doc.ID,
			Name:       doc.Title,
			Artists:    doc.Artists,
			ArtistIDs:  doc.ArtistIDs,
			DurationMs: doc.Length,
			AlbumID:    doc.ReleaseGroupID,
			AlbumName:  doc.AlbumName,
		})
	}
	return out, nil
}

func (c *Client) searchIndex(ctx context.Context, index, query string, limit int, filter string) ([]any, error) {
	if limit <= 0 {
		limit = 10
	}
	req := &meilisearch.SearchRequest{Query: query, Limit: int64(limit)}
	if filter != "" {
		req.Filter = filter
	}
	res, err := c.meili.Index(index).SearchWithContext(ctx, query, req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", musiccatalog.ErrFetchFailed, err)
	}
	return res.Hits, nil
}

func decodeHit(hit any, dest any) error {
	b, err := json.Marshal(hit)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, dest)
}

func yearFromDate(date string) *int {
	date = strings.TrimSpace(date)
	if len(date) < 4 {
		return nil
	}
	var year int
	if _, err := fmt.Sscanf(date[:4], "%d", &year); err != nil || year < 1000 {
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

func isAlreadyExists(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "already exists") || strings.Contains(msg, "index_already_exists")
}

// HTTPStatus helpers for tests / health.
func Ping(url string) error {
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get(strings.TrimRight(url, "/") + "/health")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("meilisearch health status %d", res.StatusCode)
	}
	return nil
}
