package local

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

type EmbeddingDoc struct {
	EntityType string
	MBID       string
	EmbedText  string
	TextHash   string
}

func hashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return fmt.Sprintf("%x", sum[:])
}

// PopulateSearchDocuments inserts rated MusicBrainz entities into the sidecar index.
// It does not duplicate the catalog — only ids, names, aliases, and search text.
func (s *Store) PopulateSearchDocuments(ctx context.Context) (inserted int, err error) {
	if !s.Configured() {
		return 0, ErrNotConfigured
	}
	steps := []struct {
		name string
		fn   func(context.Context) (int, error)
	}{
		{"artists", s.populateArtists},
		{"albums", s.populateAlbums},
		{"tracks", s.populateTracks},
		{"album backfill", s.backfillAlbumsFromTracks},
		{"artist backfill", s.backfillArtistsFromDocs},
	}
	for _, step := range steps {
		n, err := step.fn(ctx)
		if err != nil {
			return inserted, err
		}
		inserted += n
		fmt.Printf("jedflix search populate %s: +%d\n", step.name, n)
	}
	return inserted, nil
}

func (s *Store) populateArtists(ctx context.Context) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO jedflix.search_documents (
			entity_type, mbid, name, name_norm, artists, artist_ids, genres, aliases,
			popularity, embed_text, tsv, updated_at
		)
		SELECT 'artist', a.gid, a.name,
			lower(jedflix.f_unaccent(a.name || ' ' || COALESCE(alias.names, ''))),
			ARRAY[a.name]::text[],
			ARRAY[a.gid]::uuid[],
			COALESCE(genre.names, '{}'),
			COALESCE(alias.list, '{}'),
			LEAST(COALESCE(am.rating_count, 0), 10000),
			'Artist: ' || a.name || COALESCE('. Also known as: ' || alias.names, '') || COALESCE('. Genres: ' || genre.joined, ''),
			setweight(to_tsvector('simple', jedflix.f_unaccent(a.name)), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(alias.names, ''))), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(genre.joined, ''))), 'C'),
			now()
		FROM musicbrainz.artist a
		JOIN musicbrainz.artist_meta am ON am.id = a.id AND am.rating_count > 0
		LEFT JOIN LATERAL (
			SELECT string_agg(DISTINCT aa.name, ' ') AS names,
				array_agg(DISTINCT aa.name) AS list
			FROM musicbrainz.artist_alias aa
			WHERE aa.artist = a.id
		) alias ON true
		LEFT JOIN LATERAL (
			SELECT array_agg(t.name) AS names, string_agg(t.name, ' ') AS joined
			FROM (
				SELECT t.name
				FROM musicbrainz.artist_tag at
				JOIN musicbrainz.tag t ON t.id = at.tag
				WHERE at.artist = a.id
				ORDER BY at.count DESC
				LIMIT 8
			) t
		) genre ON true
		ON CONFLICT (entity_type, mbid) DO NOTHING
	`)
	if err != nil {
		return 0, fmt.Errorf("populate artists: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *Store) populateAlbums(ctx context.Context) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO jedflix.search_documents (
			entity_type, mbid, name, name_norm, artists, artist_ids, year, genres, aliases,
			popularity, embed_text, tsv, updated_at
		)
		SELECT 'album', rg.gid, rg.name,
			lower(jedflix.f_unaccent(rg.name || ' ' || COALESCE(ac.name, '') || ' ' || COALESCE(alias.names, ''))),
			COALESCE(credits.names, '{}'),
			COALESCE(credits.ids, '{}'),
			rgm.first_release_date_year,
			COALESCE(genre.names, '{}'),
			COALESCE(alias.list, '{}'),
			LEAST(COALESCE(rgm.rating_count, 0), 10000),
			'Album: ' || rg.name || COALESCE(' by ' || ac.name, '') ||
				COALESCE(' (' || rgm.first_release_date_year::text || ')', '') ||
				COALESCE('. Also known as: ' || alias.names, '') ||
				COALESCE('. Genres: ' || genre.joined, ''),
			setweight(to_tsvector('simple', jedflix.f_unaccent(rg.name)), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(alias.names, ''))), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(ac.name, ''))), 'B') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(genre.joined, ''))), 'C'),
			now()
		FROM musicbrainz.release_group rg
		JOIN musicbrainz.release_group_meta rgm ON rgm.id = rg.id AND rgm.rating_count > 0
		JOIN musicbrainz.artist_credit ac ON ac.id = rg.artist_credit
		LEFT JOIN LATERAL (
			SELECT array_agg(acn.name ORDER BY acn.position) AS names,
				array_agg(a.gid ORDER BY acn.position) AS ids
			FROM musicbrainz.artist_credit_name acn
			JOIN musicbrainz.artist a ON a.id = acn.artist
			WHERE acn.artist_credit = rg.artist_credit
		) credits ON true
		LEFT JOIN LATERAL (
			SELECT string_agg(DISTINCT rga.name, ' ') AS names,
				array_agg(DISTINCT rga.name) AS list
			FROM musicbrainz.release_group_alias rga
			WHERE rga.release_group = rg.id
		) alias ON true
		LEFT JOIN LATERAL (
			SELECT array_agg(t.name) AS names, string_agg(t.name, ' ') AS joined
			FROM (
				SELECT t.name
				FROM musicbrainz.release_group_tag rgt
				JOIN musicbrainz.tag t ON t.id = rgt.tag
				WHERE rgt.release_group = rg.id
				ORDER BY rgt.count DESC
				LIMIT 8
			) t
		) genre ON true
		ON CONFLICT (entity_type, mbid) DO NOTHING
	`)
	if err != nil {
		return 0, fmt.Errorf("populate albums: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *Store) populateTracks(ctx context.Context) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO jedflix.search_documents (
			entity_type, mbid, name, name_norm, artists, artist_ids, album_name, album_id,
			year, genres, aliases, duration_ms, popularity, embed_text, tsv, updated_at
		)
		SELECT 'track', rec.gid, rec.name,
			lower(jedflix.f_unaccent(rec.name || ' ' || COALESCE(ac.name, '') || ' ' || COALESCE(alias.names, '') || ' ' || COALESCE(album.album_name, ''))),
			COALESCE(credits.names, '{}'),
			COALESCE(credits.ids, '{}'),
			COALESCE(album.album_name, ''),
			album.album_id,
			NULL::int,
			COALESCE(genre.names, '{}'),
			COALESCE(alias.list, '{}'),
			COALESCE(NULLIF(album.length, 0), rec.length, 0),
			LEAST(COALESCE(rm.rating_count, 0), 10000),
			'Track: ' || rec.name || COALESCE(' by ' || ac.name, '') ||
				COALESCE('. Album: ' || album.album_name, '') ||
				COALESCE('. Also known as: ' || alias.names, '') ||
				COALESCE('. Genres: ' || genre.joined, ''),
			setweight(to_tsvector('simple', jedflix.f_unaccent(rec.name)), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(alias.names, ''))), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(ac.name, ''))), 'B') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(album.album_name, ''))), 'C') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(genre.joined, ''))), 'C'),
			now()
		FROM musicbrainz.recording rec
		JOIN musicbrainz.recording_meta rm ON rm.id = rec.id AND rm.rating_count > 0
		JOIN musicbrainz.artist_credit ac ON ac.id = rec.artist_credit
		LEFT JOIN LATERAL (
			SELECT array_agg(acn.name ORDER BY acn.position) AS names,
				array_agg(a.gid ORDER BY acn.position) AS ids
			FROM musicbrainz.artist_credit_name acn
			JOIN musicbrainz.artist a ON a.id = acn.artist
			WHERE acn.artist_credit = rec.artist_credit
		) credits ON true
		LEFT JOIN LATERAL (
			SELECT string_agg(DISTINCT ra.name, ' ') AS names,
				array_agg(DISTINCT ra.name) AS list
			FROM musicbrainz.recording_alias ra
			WHERE ra.recording = rec.id
		) alias ON true
		LEFT JOIN LATERAL (`+preferredRecordingAlbumSQL+`) album ON true
		LEFT JOIN LATERAL (
			SELECT array_agg(t.name) AS names, string_agg(t.name, ' ') AS joined
			FROM (
				SELECT t.name
				FROM musicbrainz.recording_tag rt
				JOIN musicbrainz.tag t ON t.id = rt.tag
				WHERE rt.recording = rec.id
				ORDER BY rt.count DESC
				LIMIT 6
			) t
		) genre ON true
		ON CONFLICT (entity_type, mbid) DO NOTHING
	`)
	if err != nil {
		return 0, fmt.Errorf("populate tracks: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *Store) backfillAlbumsFromTracks(ctx context.Context) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO jedflix.search_documents (
			entity_type, mbid, name, name_norm, artists, artist_ids, year, popularity, embed_text, tsv, updated_at
		)
		SELECT DISTINCT ON (d.album_id)
			'album', d.album_id, d.album_name,
			lower(jedflix.f_unaccent(d.album_name || ' ' || array_to_string(d.artists, ' '))),
			d.artists, d.artist_ids, d.year, d.popularity,
			'Album: ' || d.album_name || COALESCE(' by ' || array_to_string(d.artists, ', '), ''),
			setweight(to_tsvector('simple', jedflix.f_unaccent(d.album_name)), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(array_to_string(d.artists, ' '))), 'B'),
			now()
		FROM jedflix.search_documents d
		WHERE d.entity_type = 'track' AND d.album_id IS NOT NULL AND d.album_name <> ''
		ON CONFLICT (entity_type, mbid) DO NOTHING
	`)
	if err != nil {
		return 0, fmt.Errorf("backfill albums: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *Store) backfillArtistsFromDocs(ctx context.Context) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO jedflix.search_documents (
			entity_type, mbid, name, name_norm, artists, artist_ids, popularity, embed_text, tsv, updated_at
		)
		SELECT DISTINCT ON (artist_id)
			'artist', artist_id, artist_name,
			lower(jedflix.f_unaccent(artist_name)),
			ARRAY[artist_name]::text[],
			ARRAY[artist_id]::uuid[],
			0,
			'Artist: ' || artist_name,
			setweight(to_tsvector('simple', jedflix.f_unaccent(artist_name)), 'A'),
			now()
		FROM (
			SELECT unnest(artist_ids) AS artist_id, unnest(artists) AS artist_name
			FROM jedflix.search_documents
			WHERE entity_type IN ('album', 'track')
		) x
		WHERE artist_id IS NOT NULL AND artist_name <> ''
		ON CONFLICT (entity_type, mbid) DO NOTHING
	`)
	if err != nil {
		return 0, fmt.Errorf("backfill artists: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *Store) ListMissingEmbeddings(ctx context.Context, limit int) ([]EmbeddingDoc, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	if limit <= 0 {
		limit = 32
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT d.entity_type, d.mbid::text, d.embed_text
		FROM jedflix.search_documents d
		LEFT JOIN jedflix.music_embeddings e
			ON e.entity_type = d.entity_type AND e.mbid = d.mbid
		WHERE d.embed_text <> '' AND e.mbid IS NULL
		ORDER BY d.popularity DESC, d.mbid
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list missing embeddings: %w", err)
	}
	defer rows.Close()
	out := make([]EmbeddingDoc, 0, limit)
	for rows.Next() {
		var doc EmbeddingDoc
		if err := rows.Scan(&doc.EntityType, &doc.MBID, &doc.EmbedText); err != nil {
			return nil, err
		}
		doc.TextHash = hashText(doc.EmbedText)
		out = append(out, doc)
	}
	return out, rows.Err()
}

func (s *Store) SaveEmbeddings(ctx context.Context, docs []EmbeddingDoc, vectors [][]float32) error {
	if !s.Configured() {
		return ErrNotConfigured
	}
	if len(docs) != len(vectors) {
		return fmt.Errorf("embedding count mismatch")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO jedflix.music_embeddings (entity_type, mbid, text_hash, embedding, updated_at)
		VALUES ($1, $2::uuid, $3, $4::halfvec, now())
		ON CONFLICT (entity_type, mbid) DO UPDATE SET
			text_hash = EXCLUDED.text_hash,
			embedding = EXCLUDED.embedding,
			updated_at = now()
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for i, doc := range docs {
		if _, err := stmt.ExecContext(ctx, doc.EntityType, doc.MBID, doc.TextHash, formatHalfvec(vectors[i])); err != nil {
			return fmt.Errorf("save embedding %s: %w", doc.MBID, err)
		}
	}
	return tx.Commit()
}

func (s *Store) SimilarTracks(ctx context.Context, trackMBID string, limit int) ([]SearchHit, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	trackMBID = strings.ToLower(strings.TrimSpace(trackMBID))
	if trackMBID == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT d.entity_type, d.mbid::text, d.name, d.artists, d.artist_ids::text[],
			d.album_name, COALESCE(d.album_id::text, ''), d.year, d.duration_ms,
			d.genres, d.embed_text,
			1 - (e.embedding <=> seed.embedding) AS vec_score,
			0::float AS unused
		FROM jedflix.music_embeddings seed
		JOIN jedflix.music_embeddings e
			ON e.entity_type = 'track' AND e.mbid <> seed.mbid
		JOIN jedflix.search_documents d
			ON d.entity_type = e.entity_type AND d.mbid = e.mbid
		WHERE seed.entity_type = 'track' AND seed.mbid = $1::uuid
		ORDER BY e.embedding <=> seed.embedding
		LIMIT $2
	`, trackMBID, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: similar tracks: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()
	return scanHits(rows, "vector")
}

func (s *Store) DocumentCounts(ctx context.Context) (docs, embeddings int, err error) {
	if !s.Configured() {
		return 0, 0, ErrNotConfigured
	}
	err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM jedflix.search_documents`).Scan(&docs)
	if err != nil {
		return 0, 0, err
	}
	err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM jedflix.music_embeddings`).Scan(&embeddings)
	return docs, embeddings, err
}

func (s *Store) DB() *sql.DB {
	if s == nil {
		return nil
	}
	return s.db
}
