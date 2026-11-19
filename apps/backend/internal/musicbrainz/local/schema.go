package local

import (
	"context"
	"database/sql"
	"fmt"
)

// EnsureSearchSchema installs search sidecar tables in jedflix.
// MusicBrainz replica tables are never altered (mbslave owns those).
func EnsureSearchSchema(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return ErrNotConfigured
	}
	stmts := []string{
		`CREATE SCHEMA IF NOT EXISTS jedflix`,
		`CREATE EXTENSION IF NOT EXISTS pg_trgm`,
		`CREATE EXTENSION IF NOT EXISTS unaccent`,
		`CREATE OR REPLACE FUNCTION jedflix.f_unaccent(text)
			RETURNS text
			LANGUAGE sql
			IMMUTABLE
			PARALLEL SAFE
			AS $$ SELECT public.unaccent('public.unaccent', $1) $$`,
		`CREATE TABLE IF NOT EXISTS jedflix.search_documents (
			entity_type text NOT NULL CHECK (entity_type IN ('artist', 'album', 'track')),
			mbid uuid NOT NULL,
			name text NOT NULL,
			name_norm text NOT NULL DEFAULT '',
			artists text[] NOT NULL DEFAULT '{}',
			artist_ids uuid[] NOT NULL DEFAULT '{}',
			album_name text NOT NULL DEFAULT '',
			album_id uuid,
			year int,
			genres text[] NOT NULL DEFAULT '{}',
			aliases text[] NOT NULL DEFAULT '{}',
			duration_ms int NOT NULL DEFAULT 0,
			popularity int NOT NULL DEFAULT 0,
			tsv tsvector,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (entity_type, mbid)
		)`,
		`CREATE TABLE IF NOT EXISTS jedflix.search_state (
			key text PRIMARY KEY,
			value text NOT NULL DEFAULT '',
			updated_at timestamptz NOT NULL DEFAULT now()
		)`,
	}
	for _, stmt := range stmts {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("jedflix search schema: %w", err)
		}
	}
	if err := ensureIndex(ctx, db, "search_documents_tsv_idx",
		`CREATE INDEX CONCURRENTLY IF NOT EXISTS search_documents_tsv_idx
		 ON jedflix.search_documents USING gin (tsv)`); err != nil {
		return err
	}
	// Document matching uses the full-text index. Trigrams now index terms only.
	_, err := db.ExecContext(ctx, `DROP INDEX CONCURRENTLY IF EXISTS jedflix.search_documents_trgm_idx`)
	return err
}

func indexExists(ctx context.Context, db *sql.DB, name string) (bool, error) {
	var ok bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('jedflix.' || $1) AND indisvalid
		)
	`, name).Scan(&ok)
	return ok, err
}

func ensureIndex(ctx context.Context, db *sql.DB, name, stmt string) error {
	ok, err := indexExists(ctx, db, name)
	if err != nil {
		return fmt.Errorf("check index %s: %w", name, err)
	}
	if ok {
		return nil
	}
	// An interrupted concurrent build leaves an invalid index behind.
	if _, err := db.ExecContext(ctx, `DROP INDEX CONCURRENTLY IF EXISTS jedflix.`+name); err != nil {
		return fmt.Errorf("remove invalid index %s: %w", name, err)
	}
	if _, err := db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("create index %s: %w", name, err)
	}
	return nil
}

func (s *Store) SearchReady(ctx context.Context) bool {
	if !s.Configured() {
		return false
	}
	var ok bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM jedflix.search_documents LIMIT 1)
	`).Scan(&ok)
	return err == nil && ok
}

// SearchDocumentsReady is true as soon as any indexed subset exists.
// Search must not wait for a full catalog backfill.
func SearchDocumentsReady(artists, albums, tracks int) bool {
	return artists > 0 || albums > 0 || tracks > 0
}

// ShouldPopulateSearchDocuments is true only while the sidecar index is still
// filling. A full rescan of a populated catalog holds write locks for minutes.
func ShouldPopulateSearchDocuments(docs int) bool {
	return docs < 10000
}

func (s *Store) SetState(ctx context.Context, key, value string) error {
	if !s.Configured() {
		return ErrNotConfigured
	}
	return setSearchState(ctx, s.db, key, value)
}

func (s *Store) GetState(ctx context.Context, key string) (string, error) {
	if !s.Configured() {
		return "", ErrNotConfigured
	}
	var value string
	err := s.db.QueryRowContext(ctx, `
		SELECT value FROM jedflix.search_state WHERE key = $1
	`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}
