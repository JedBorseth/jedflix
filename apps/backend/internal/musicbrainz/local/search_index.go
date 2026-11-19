package local

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"log"
	"time"
)

const (
	popularityKey     = "search_release_popularity"
	popularityVersion = "1"
	termsKey          = "search_term_dictionary"
	termsVersion      = "1"
	populateKey       = "search_initial_populate"

	// Keep the expression identical in the index and the candidate query.
	releasePopularitySQL = "ln(1.0 + release_count) * 0.75 + ln(1.0 + popularity) * 0.25"
	ratingPopularitySQL  = "ln(1.0 + popularity) * 0.25"
)

// MaintainSearch brings the sidecar up to date without delaying HTTP startup.
func (s *Store) MaintainSearch(ctx context.Context) {
	for ctx.Err() == nil {
		err := s.withSearchMaintenanceLock(ctx, func() error {
			if err := EnsureSearchSchema(ctx, s.db); err != nil {
				return err
			}
			if err := s.populateIfNeeded(ctx); err != nil {
				return err
			}
			return s.refreshSearchRanking(ctx)
		})
		if err == nil {
			return
		}
		log.Printf("music search maintenance will retry: %v", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
	}
}

func (s *Store) withSearchMaintenanceLock(ctx context.Context, work func() error) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	const lockID int64 = 56200826872022315
	var acquired bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_try_advisory_lock($1)", lockID).Scan(&acquired); err != nil {
		return err
	}
	if !acquired {
		return fmt.Errorf("another backend is maintaining the search index")
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if _, err := conn.ExecContext(unlockCtx, "SELECT pg_advisory_unlock($1)", lockID); err != nil {
			// A pooled session must never be returned with the lock held.
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		}
	}()
	return work()
}

func (s *Store) populateIfNeeded(ctx context.Context) error {
	state, err := s.GetState(ctx, populateKey)
	if err != nil || state == "done" {
		return err
	}
	if state == "" {
		var docs int
		err := s.db.QueryRowContext(ctx, `
			SELECT count(*) FROM (SELECT 1 FROM jedflix.search_documents LIMIT 10000) d
		`).Scan(&docs)
		if err != nil {
			return err
		}
		if !ShouldPopulateSearchDocuments(docs) {
			return s.SetState(ctx, populateKey, "done")
		}
	}
	if err := s.SetState(ctx, populateKey, "running"); err != nil {
		return err
	}
	if _, err := s.PopulateSearchDocuments(ctx); err != nil {
		return err
	}
	return s.SetState(ctx, populateKey, "done")
}

func (s *Store) refreshSearchRanking(ctx context.Context) error {
	if err := s.addReleaseCount(ctx); err != nil {
		return err
	}
	version, err := s.GetState(ctx, popularityKey)
	if err != nil {
		return err
	}
	if version != popularityVersion {
		if err := s.updateReleaseCounts(ctx); err != nil {
			return err
		}
	}
	if err := ensureIndex(ctx, s.db, "search_documents_release_pop_idx",
		`CREATE INDEX CONCURRENTLY IF NOT EXISTS search_documents_release_pop_idx
		ON jedflix.search_documents ((`+releasePopularitySQL+`) DESC, entity_type, mbid)`); err != nil {
		return err
	}
	version, err = s.GetState(ctx, termsKey)
	if err != nil {
		return err
	}
	var present bool
	if err := s.db.QueryRowContext(ctx,
		`SELECT to_regclass('jedflix.search_terms') IS NOT NULL`).Scan(&present); err != nil {
		return err
	}
	if version != termsVersion || !present {
		return s.rebuildSearchTerms(ctx)
	}
	return nil
}

func (s *Store) addReleaseCount(ctx context.Context) error {
	// Check first so a normal restart doesn't take an exclusive lock.
	var present bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_attribute
			WHERE attrelid = 'jedflix.search_documents'::regclass
			  AND attname = 'release_count' AND NOT attisdropped
		)
	`).Scan(&present); err != nil || present {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SET LOCAL lock_timeout = '1s'`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		ALTER TABLE jedflix.search_documents ADD COLUMN IF NOT EXISTS release_count int NOT NULL DEFAULT 0
	`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) updateReleaseCounts(ctx context.Context) error {
	for _, step := range []struct{ entity, source string }{
		{"track", `
			-- A grouped scan of the recording index avoids nearly a million
			-- random track index probes when the MusicBrainz catalog is cold.
			SELECT r.gid AS mbid, t.n
			FROM (
				SELECT recording, count(*)::int AS n
				FROM musicbrainz.track
				GROUP BY recording
				ORDER BY recording
			) t
			JOIN musicbrainz.recording r ON r.id = t.recording
		`},
		{"album", `
			SELECT d.mbid, count(r.release_group)::int AS n
			FROM jedflix.search_documents d
			JOIN musicbrainz.release_group rg ON rg.gid = d.mbid
			LEFT JOIN musicbrainz.release r ON r.release_group = rg.id
			WHERE d.entity_type = $1 GROUP BY d.mbid
		`},
		{"artist", `
			WITH credits AS (
				SELECT artist_credit, count(*)::int AS n
				FROM musicbrainz.release GROUP BY artist_credit
			), artists AS (
				SELECT acn.artist, sum(c.n)::int AS n
				FROM credits c
				JOIN (SELECT DISTINCT artist, artist_credit FROM musicbrainz.artist_credit_name) acn
				  ON acn.artist_credit = c.artist_credit
				GROUP BY acn.artist
			)
			SELECT d.mbid, COALESCE(artists.n, 0) AS n
			FROM jedflix.search_documents d
			JOIN musicbrainz.artist a ON a.gid = d.mbid
			LEFT JOIN artists ON artists.artist = a.id
			WHERE d.entity_type = $1
		`},
	} {
		log.Printf("music search: updating %s release counts", step.entity)
		_, err := s.execSearchMaintenance(ctx, step.entity+" release counts", `
			UPDATE jedflix.search_documents d SET release_count = COALESCE(counts.n, 0)
			FROM (`+step.source+`) counts
			WHERE d.entity_type = $1 AND d.mbid = counts.mbid
			  AND d.release_count IS DISTINCT FROM counts.n
		`, step.entity)
		if err != nil {
			return err
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM jedflix.search_state WHERE key = $1`, termsKey); err != nil {
		return err
	}
	if err := setSearchState(ctx, tx, popularityKey, popularityVersion); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) rebuildSearchTerms(ctx context.Context) error {
	log.Println("music search: rebuilding term dictionary")
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`CREATE TABLE jedflix.search_terms_build (
			term text COLLATE "C" PRIMARY KEY, ndoc int NOT NULL, weight bigint NOT NULL
		)`,
		`INSERT INTO jedflix.search_terms_build (term, ndoc, weight)
		SELECT term, count(*)::int,
			sum(1 + LEAST(d.release_count, 100) + LEAST(d.popularity, 100))
		FROM jedflix.search_documents d, unnest(tsvector_to_array(d.tsv)) AS term
		WHERE length(term) BETWEEN 2 AND 40
		GROUP BY term`,
		`CREATE INDEX search_terms_build_trgm_idx ON jedflix.search_terms_build USING gin (term gin_trgm_ops)`,
		`ANALYZE jedflix.search_terms_build`,
		`SET LOCAL lock_timeout = '1s'`,
		`DROP TABLE IF EXISTS jedflix.search_terms`,
		`ALTER TABLE jedflix.search_terms_build RENAME TO search_terms`,
		`ALTER INDEX jedflix.search_terms_build_pkey RENAME TO search_terms_pkey`,
		`ALTER INDEX jedflix.search_terms_build_trgm_idx RENAME TO search_terms_trgm_idx`,
	} {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("rebuild search terms: %w", err)
		}
	}
	if err := setSearchState(ctx, tx, termsKey, termsVersion); err != nil {
		return err
	}
	return tx.Commit()
}

type stateWriter interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func setSearchState(ctx context.Context, db stateWriter, key, value string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO jedflix.search_state (key, value, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`, key, value)
	return err
}
