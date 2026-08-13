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
	docs, _, countErr := s.DocumentCounts(ctx)
	bulk := countErr != nil || docs < 10000
	if bulk {
		fmt.Println("jedflix search populate: dropping GIN indexes for bulk load")
		if err := dropSearchDocumentIndexes(ctx, s.db); err != nil {
			return 0, err
		}
	}
	defer func() {
		if !bulk {
			return
		}
		fmt.Println("jedflix search populate: rebuilding GIN indexes")
		if idxErr := createSearchDocumentIndexes(ctx, s.db); idxErr != nil {
			if err == nil {
				err = idxErr
			}
		}
		if _, analyzeErr := s.db.ExecContext(ctx, `ANALYZE jedflix.search_documents`); analyzeErr != nil {
			fmt.Printf("jedflix search populate analyze: %v\n", analyzeErr)
		}
	}()
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
		fmt.Printf("jedflix search populate %s: starting\n", step.name)
		n, stepErr := step.fn(ctx)
		if stepErr != nil {
			return inserted, stepErr
		}
		inserted += n
		fmt.Printf("jedflix search populate %s: +%d\n", step.name, n)
	}
	return inserted, nil
}

func (s *Store) execPopulate(ctx context.Context, name, query string) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("populate %s: begin: %w", name, err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, stmt := range []string{
		`SET LOCAL work_mem = '128MB'`,
		`SET LOCAL enable_nestloop = off`,
		`SET LOCAL synchronous_commit = off`,
		`SET LOCAL max_parallel_workers_per_gather = 4`,
	} {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return 0, fmt.Errorf("populate %s: %s: %w", name, stmt, err)
		}
	}
	res, err := tx.ExecContext(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("populate %s: %w", name, err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("populate %s: commit: %w", name, err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func (s *Store) populateArtists(ctx context.Context) (int, error) {
	return s.execPopulate(ctx, "artists", `
		INSERT INTO jedflix.search_documents (
			entity_type, mbid, name, name_norm, artists, artist_ids, genres, aliases,
			popularity, embed_text, tsv, updated_at
		)
		WITH rated AS MATERIALIZED (
			SELECT a.id, a.gid, a.name, LEAST(COALESCE(am.rating_count, 0), 10000) AS popularity
			FROM musicbrainz.artist a
			JOIN musicbrainz.artist_meta am ON am.id = a.id
			WHERE COALESCE(am.rating_count, 0) > 0
		),
		aliases AS MATERIALIZED (
			SELECT aa.artist,
				string_agg(DISTINCT aa.name, ' ') AS names,
				array_agg(DISTINCT aa.name) AS list
			FROM rated r
			JOIN musicbrainz.artist_alias aa ON aa.artist = r.id
			GROUP BY aa.artist
		),
		genres AS MATERIALIZED (
			SELECT x.artist, array_agg(x.name) AS names, string_agg(x.name, ' ') AS joined
			FROM (
				SELECT at.artist, t.name,
					row_number() OVER (PARTITION BY at.artist ORDER BY at.count DESC) AS rn
				FROM rated r
				JOIN musicbrainz.artist_tag at ON at.artist = r.id
				JOIN musicbrainz.tag t ON t.id = at.tag
			) x
			WHERE x.rn <= 8
			GROUP BY x.artist
		)
		SELECT 'artist', r.gid, r.name,
			lower(jedflix.f_unaccent(r.name || ' ' || COALESCE(alias.names, ''))),
			ARRAY[r.name]::text[],
			ARRAY[r.gid]::uuid[],
			COALESCE(genre.names, '{}'),
			COALESCE(alias.list, '{}'),
			r.popularity,
			'Artist: ' || r.name || COALESCE('. Also known as: ' || alias.names, '') || COALESCE('. Genres: ' || genre.joined, ''),
			setweight(to_tsvector('simple', jedflix.f_unaccent(r.name)), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(alias.names, ''))), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(genre.joined, ''))), 'C'),
			now()
		FROM rated r
		LEFT JOIN aliases alias ON alias.artist = r.id
		LEFT JOIN genres genre ON genre.artist = r.id
		ON CONFLICT (entity_type, mbid) DO NOTHING
	`)
}

func (s *Store) populateAlbums(ctx context.Context) (int, error) {
	return s.execPopulate(ctx, "albums", `
		INSERT INTO jedflix.search_documents (
			entity_type, mbid, name, name_norm, artists, artist_ids, year, genres, aliases,
			popularity, embed_text, tsv, updated_at
		)
		WITH rated AS MATERIALIZED (
			SELECT rg.id, rg.gid, rg.name, rg.artist_credit,
				rgm.first_release_date_year,
				LEAST(COALESCE(rgm.rating_count, 0), 10000) AS popularity
			FROM musicbrainz.release_group rg
			JOIN musicbrainz.release_group_meta rgm ON rgm.id = rg.id
			WHERE COALESCE(rgm.rating_count, 0) > 0
		),
		credits AS MATERIALIZED (
			SELECT acn.artist_credit,
				array_agg(acn.name ORDER BY acn.position) AS names,
				array_agg(a.gid ORDER BY acn.position) AS ids
			FROM (SELECT DISTINCT artist_credit FROM rated) r
			JOIN musicbrainz.artist_credit_name acn ON acn.artist_credit = r.artist_credit
			JOIN musicbrainz.artist a ON a.id = acn.artist
			GROUP BY acn.artist_credit
		),
		aliases AS MATERIALIZED (
			SELECT rga.release_group,
				string_agg(DISTINCT rga.name, ' ') AS names,
				array_agg(DISTINCT rga.name) AS list
			FROM rated r
			JOIN musicbrainz.release_group_alias rga ON rga.release_group = r.id
			GROUP BY rga.release_group
		),
		genres AS MATERIALIZED (
			SELECT x.release_group, array_agg(x.name) AS names, string_agg(x.name, ' ') AS joined
			FROM (
				SELECT rgt.release_group, t.name,
					row_number() OVER (PARTITION BY rgt.release_group ORDER BY rgt.count DESC) AS rn
				FROM rated r
				JOIN musicbrainz.release_group_tag rgt ON rgt.release_group = r.id
				JOIN musicbrainz.tag t ON t.id = rgt.tag
			) x
			WHERE x.rn <= 8
			GROUP BY x.release_group
		)
		SELECT 'album', r.gid, r.name,
			lower(jedflix.f_unaccent(r.name || ' ' || COALESCE(ac.name, '') || ' ' || COALESCE(alias.names, ''))),
			COALESCE(credits.names, '{}'),
			COALESCE(credits.ids, '{}'),
			r.first_release_date_year,
			COALESCE(genre.names, '{}'),
			COALESCE(alias.list, '{}'),
			r.popularity,
			'Album: ' || r.name || COALESCE(' by ' || ac.name, '') ||
				COALESCE(' (' || r.first_release_date_year::text || ')', '') ||
				COALESCE('. Also known as: ' || alias.names, '') ||
				COALESCE('. Genres: ' || genre.joined, ''),
			setweight(to_tsvector('simple', jedflix.f_unaccent(r.name)), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(alias.names, ''))), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(ac.name, ''))), 'B') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(genre.joined, ''))), 'C'),
			now()
		FROM rated r
		JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
		LEFT JOIN credits ON credits.artist_credit = r.artist_credit
		LEFT JOIN aliases alias ON alias.release_group = r.id
		LEFT JOIN genres genre ON genre.release_group = r.id
		ON CONFLICT (entity_type, mbid) DO NOTHING
	`)
}

func (s *Store) populateTracks(ctx context.Context) (int, error) {
	return s.execPopulate(ctx, "tracks", `
		INSERT INTO jedflix.search_documents (
			entity_type, mbid, name, name_norm, artists, artist_ids, album_name, album_id,
			year, genres, aliases, duration_ms, popularity, embed_text, tsv, updated_at
		)
		WITH rated AS MATERIALIZED (
			SELECT rec.id, rec.gid, rec.name, rec.artist_credit, rec.length,
				LEAST(COALESCE(rm.rating_count, 0), 10000) AS popularity
			FROM musicbrainz.recording rec
			JOIN musicbrainz.recording_meta rm ON rm.id = rec.id
			WHERE COALESCE(rm.rating_count, 0) > 0
		),
		credits AS MATERIALIZED (
			SELECT acn.artist_credit,
				array_agg(acn.name ORDER BY acn.position) AS names,
				array_agg(a.gid ORDER BY acn.position) AS ids
			FROM (SELECT DISTINCT artist_credit FROM rated) r
			JOIN musicbrainz.artist_credit_name acn ON acn.artist_credit = r.artist_credit
			JOIN musicbrainz.artist a ON a.id = acn.artist
			GROUP BY acn.artist_credit
		),
		aliases AS MATERIALIZED (
			SELECT ra.recording,
				string_agg(DISTINCT ra.name, ' ') AS names,
				array_agg(DISTINCT ra.name) AS list
			FROM rated r
			JOIN musicbrainz.recording_alias ra ON ra.recording = r.id
			GROUP BY ra.recording
		),
		genres AS MATERIALIZED (
			SELECT x.recording, array_agg(x.name) AS names, string_agg(x.name, ' ') AS joined
			FROM (
				SELECT rt.recording, t.name,
					row_number() OVER (PARTITION BY rt.recording ORDER BY rt.count DESC) AS rn
				FROM rated r
				JOIN musicbrainz.recording_tag rt ON rt.recording = r.id
				JOIN musicbrainz.tag t ON t.id = rt.tag
			) x
			WHERE x.rn <= 6
			GROUP BY x.recording
		),
		albums AS MATERIALIZED (
			SELECT DISTINCT ON (t.recording)
				t.recording,
				rg.gid AS album_id,
				rg.name AS album_name,
				COALESCE(NULLIF(t.length, 0), 0) AS length
			FROM musicbrainz.track t
			JOIN rated r ON r.id = t.recording
			JOIN musicbrainz.medium m ON m.id = t.medium
			JOIN musicbrainz.release rel ON rel.id = m.release
			JOIN musicbrainz.release_group rg ON rg.id = rel.release_group
			LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
			LEFT JOIN musicbrainz.release_status rs ON rs.id = rel.status
			ORDER BY t.recording,
				CASE lower(COALESCE(rpt.name, ''))
					WHEN 'album' THEN 0
					WHEN 'ep' THEN 1
					WHEN 'single' THEN 2
					ELSE 3
				END,
				CASE WHEN lower(COALESCE(rs.name, '')) = 'official' THEN 0 ELSE 1 END,
				rel.id
		)
		SELECT 'track', r.gid, r.name,
			lower(jedflix.f_unaccent(r.name || ' ' || COALESCE(ac.name, '') || ' ' || COALESCE(alias.names, '') || ' ' || COALESCE(album.album_name, ''))),
			COALESCE(credits.names, '{}'),
			COALESCE(credits.ids, '{}'),
			COALESCE(album.album_name, ''),
			album.album_id,
			NULL::int,
			COALESCE(genre.names, '{}'),
			COALESCE(alias.list, '{}'),
			COALESCE(NULLIF(album.length, 0), r.length, 0),
			r.popularity,
			'Track: ' || r.name || COALESCE(' by ' || ac.name, '') ||
				COALESCE('. Album: ' || album.album_name, '') ||
				COALESCE('. Also known as: ' || alias.names, '') ||
				COALESCE('. Genres: ' || genre.joined, ''),
			setweight(to_tsvector('simple', jedflix.f_unaccent(r.name)), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(alias.names, ''))), 'A') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(ac.name, ''))), 'B') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(album.album_name, ''))), 'C') ||
			setweight(to_tsvector('simple', jedflix.f_unaccent(COALESCE(genre.joined, ''))), 'C'),
			now()
		FROM rated r
		JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
		LEFT JOIN credits ON credits.artist_credit = r.artist_credit
		LEFT JOIN aliases alias ON alias.recording = r.id
		LEFT JOIN albums album ON album.recording = r.id
		LEFT JOIN genres genre ON genre.recording = r.id
		ON CONFLICT (entity_type, mbid) DO NOTHING
	`)
}

func (s *Store) backfillAlbumsFromTracks(ctx context.Context) (int, error) {
	return s.execPopulate(ctx, "album backfill", `
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
}

func (s *Store) backfillArtistsFromDocs(ctx context.Context) (int, error) {
	return s.execPopulate(ctx, "artist backfill", `
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
