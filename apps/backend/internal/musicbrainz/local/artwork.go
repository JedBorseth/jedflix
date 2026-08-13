package local

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

const (
	ArtworkKindArtist       = "artist"
	ArtworkKindReleaseGroup = "release-group"
)

// Artwork is a JedFlix sidecar row: source image URL for an MBID.
type Artwork struct {
	MBID      string
	Kind      string
	SourceURL string
	AlbumMBID string
}

func EnsureArtworkSchema(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return ErrNotConfigured
	}
	stmts := []string{
		`CREATE SCHEMA IF NOT EXISTS jedflix`,
		`CREATE TABLE IF NOT EXISTS jedflix.artwork (
			mbid uuid PRIMARY KEY,
			kind text NOT NULL CHECK (kind IN ('artist', 'release-group')),
			source_url text NOT NULL,
			album_mbid uuid,
			updated_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS artwork_kind_idx ON jedflix.artwork (kind)`,
	}
	for _, stmt := range stmts {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("jedflix artwork schema: %w", err)
		}
	}
	return nil
}

func GetArtwork(ctx context.Context, db *sql.DB, mbid string) (*Artwork, error) {
	if db == nil {
		return nil, ErrNotConfigured
	}
	mbid = strings.ToLower(strings.TrimSpace(mbid))
	if mbid == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	var (
		kind, source string
		album        sql.NullString
	)
	err := db.QueryRowContext(ctx, `
		SELECT kind, source_url, album_mbid::text
		FROM jedflix.artwork
		WHERE mbid = $1::uuid
	`, mbid).Scan(&kind, &source, &album)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("jedflix artwork get: %w", err)
	}
	art := &Artwork{
		MBID:      mbid,
		Kind:      kind,
		SourceURL: strings.TrimSpace(source),
	}
	if album.Valid {
		art.AlbumMBID = strings.TrimSpace(album.String)
	}
	if art.SourceURL == "" {
		return nil, nil
	}
	return art, nil
}

func UpsertArtwork(ctx context.Context, db *sql.DB, art Artwork) error {
	if db == nil {
		return ErrNotConfigured
	}
	mbid := strings.ToLower(strings.TrimSpace(art.MBID))
	kind := strings.TrimSpace(art.Kind)
	source := strings.TrimSpace(art.SourceURL)
	if mbid == "" || source == "" {
		return nil
	}
	if kind != ArtworkKindArtist && kind != ArtworkKindReleaseGroup {
		kind = ArtworkKindArtist
	}
	album := strings.ToLower(strings.TrimSpace(art.AlbumMBID))
	var albumArg any
	if album != "" {
		albumArg = album
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO jedflix.artwork (mbid, kind, source_url, album_mbid, updated_at)
		VALUES ($1::uuid, $2, $3, $4::uuid, now())
		ON CONFLICT (mbid) DO UPDATE SET
			kind = EXCLUDED.kind,
			source_url = EXCLUDED.source_url,
			album_mbid = EXCLUDED.album_mbid,
			updated_at = now()
	`, mbid, kind, source, albumArg)
	if err != nil {
		return fmt.Errorf("jedflix artwork upsert: %w", err)
	}
	return nil
}

func (s *Store) GetArtwork(ctx context.Context, mbid string) (*Artwork, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	return GetArtwork(ctx, s.db, mbid)
}

func (s *Store) UpsertArtwork(ctx context.Context, art Artwork) error {
	if !s.Configured() {
		return ErrNotConfigured
	}
	return UpsertArtwork(ctx, s.db, art)
}
