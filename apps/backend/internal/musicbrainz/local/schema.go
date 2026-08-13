package local

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

const EmbeddingDim = 512

// EnsureSearchSchema installs pgvector/pg_trgm sidecar tables in jedflix.
// MusicBrainz replica tables are never altered (mbslave owns those).
func EnsureSearchSchema(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return ErrNotConfigured
	}
	stmts := []string{
		`CREATE SCHEMA IF NOT EXISTS jedflix`,
		`CREATE EXTENSION IF NOT EXISTS vector`,
		`CREATE EXTENSION IF NOT EXISTS pg_trgm`,
		`CREATE EXTENSION IF NOT EXISTS unaccent`,
		`CREATE OR REPLACE FUNCTION jedflix.f_unaccent(text)
			RETURNS text
			LANGUAGE sql
			IMMUTABLE
			PARALLEL SAFE
			AS $$ SELECT public.unaccent('public.unaccent', $1) $$`,
		`CREATE OR REPLACE FUNCTION jedflix.safe_websearch(q text)
			RETURNS tsquery
			LANGUAGE plpgsql
			IMMUTABLE
			AS $$
			BEGIN
				RETURN websearch_to_tsquery('simple', jedflix.f_unaccent(q));
			EXCEPTION WHEN OTHERS THEN
				BEGIN
					RETURN plainto_tsquery('simple', jedflix.f_unaccent(q));
				EXCEPTION WHEN OTHERS THEN
					RETURN ''::tsquery;
				END;
			END;
			$$`,
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
			embed_text text NOT NULL DEFAULT '',
			tsv tsvector,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (entity_type, mbid)
		)`,
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS jedflix.music_embeddings (
			entity_type text NOT NULL CHECK (entity_type IN ('artist', 'album', 'track')),
			mbid uuid NOT NULL,
			text_hash text NOT NULL,
			embedding halfvec(%d) NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (entity_type, mbid)
		)`, EmbeddingDim),
		`CREATE TABLE IF NOT EXISTS jedflix.search_state (
			key text PRIMARY KEY,
			value text NOT NULL DEFAULT '',
			updated_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS search_documents_type_pop_idx
			ON jedflix.search_documents (entity_type, popularity DESC)`,
		fmt.Sprintf(`CREATE INDEX IF NOT EXISTS music_embeddings_hnsw_idx
			ON jedflix.music_embeddings
			USING hnsw (embedding halfvec_cosine_ops)
			WITH (m = 16, ef_construction = 64)`),
	}
	for _, stmt := range stmts {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("jedflix search schema: %w", err)
		}
	}
	return createSearchDocumentIndexes(ctx, db)
}

func dropSearchDocumentIndexes(ctx context.Context, db *sql.DB) error {
	stmts := []string{
		`DROP INDEX IF EXISTS jedflix.search_documents_tsv_idx`,
		`DROP INDEX IF EXISTS jedflix.search_documents_trgm_idx`,
	}
	for _, stmt := range stmts {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("drop search indexes: %w", err)
		}
	}
	return nil
}

func createSearchDocumentIndexes(ctx context.Context, db *sql.DB) error {
	stmts := []string{
		`CREATE INDEX IF NOT EXISTS search_documents_tsv_idx
			ON jedflix.search_documents USING gin (tsv)`,
		`CREATE INDEX IF NOT EXISTS search_documents_trgm_idx
			ON jedflix.search_documents USING gin (name_norm gin_trgm_ops)`,
	}
	for _, stmt := range stmts {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("create search indexes: %w", err)
		}
	}
	return nil
}

func (s *Store) SearchReady(ctx context.Context) bool {
	if !s.Configured() {
		return false
	}
	var artists, albums, tracks int
	err := s.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE entity_type = 'artist'),
			COUNT(*) FILTER (WHERE entity_type = 'album'),
			COUNT(*) FILTER (WHERE entity_type = 'track')
		FROM jedflix.search_documents
	`).Scan(&artists, &albums, &tracks)
	// Wait until all three types exist so Meilisearch keeps covering
	// albums/tracks during the first backfill.
	return err == nil && artists > 1000 && albums > 1000 && tracks > 1000
}

func (s *Store) SetState(ctx context.Context, key, value string) error {
	if !s.Configured() {
		return ErrNotConfigured
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO jedflix.search_state (key, value, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`, key, value)
	return err
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

func formatHalfvec(values []float32) string {
	if len(values) == 0 {
		return "[]"
	}
	var b strings.Builder
	b.Grow(len(values) * 8)
	b.WriteByte('[')
	for i, v := range values {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%g", v)
	}
	b.WriteByte(']')
	return b.String()
}
