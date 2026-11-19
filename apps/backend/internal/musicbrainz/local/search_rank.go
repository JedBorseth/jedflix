package local

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func (s *Store) searchText(ctx context.Context, query string, limit int) ([]SearchHit, error) {
	// Bound work for arbitrary API input, including query building and edit distance.
	if runes := []rune(query); len(runes) > maxQueryRunes {
		query = string(runes[:maxQueryRunes])
	}
	hits, err := s.runTextSearch(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: text search: %w", musiccatalog.ErrFetchFailed, err)
	}
	return hits, nil
}

func (s *Store) runTextSearch(ctx context.Context, query string, limit int) ([]SearchHit, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var timeout, similarity, planMode, unaccented string
	var termsReady, popularityReady bool
	err = tx.QueryRowContext(ctx, `
		SELECT set_config('statement_timeout', '2s', true),
		       set_config('pg_trgm.similarity_threshold', '0.2', true),
		       set_config('plan_cache_mode', 'force_custom_plan', true),
		       jedflix.f_unaccent($1),
		       to_regclass('jedflix.search_terms') IS NOT NULL,
		       EXISTS (SELECT 1 FROM pg_index
		               WHERE indexrelid = to_regclass('jedflix.search_documents_release_pop_idx')
		                 AND indisvalid)
	`, query).Scan(&timeout, &similarity, &planMode, &unaccented, &termsReady, &popularityReady)
	if err != nil {
		return nil, err
	}
	tokens, err := readSearchTokens(ctx, tx, query, termsReady)
	if err != nil || len(tokens) == 0 {
		return nil, err
	}
	groups, corrected := buildTermGroups(tokens)
	rank := searchRanking{
		groups:          groups,
		query:           NormalizeSearchText(acdcAlias.ReplaceAllString(NormalizeSearchText(unaccented), "ac/dc")),
		corrected:       corrected,
		popularityReady: popularityReady,
	}
	hits, err := rank.lookup(ctx, tx, limit, false)
	if err != nil {
		return nil, err
	}
	if len(hits) < 6 && len(groups) > 1 {
		relaxed, err := rank.lookup(ctx, tx, limit, true)
		if err != nil {
			// Keep the strict results if a broad fallback times out.
			if len(hits) > 0 && isQueryTimeout(err) {
				return hits, nil
			}
			return nil, err
		}
		hits = appendUniqueHits(hits, relaxed, limit)
	}
	return hits, tx.Commit()
}

type searchRanking struct {
	groups          []termGroup
	query           string
	corrected       bool
	popularityReady bool
}

func (r searchRanking) lookup(ctx context.Context, tx *sql.Tx, limit int, relaxed bool) ([]SearchHit, error) {
	groupQueries := make([]string, 0, len(r.groups))
	titleQueries := make([]string, 0, len(r.groups))
	common := 0
	for _, group := range r.groups {
		groupQueries = append(groupQueries, group.tsquery(""))
		titleQueries = append(titleQueries, group.tsquery("A"))
		if group.ndoc >= commonDocumentCount {
			common++
		}
	}
	join := " & "
	if relaxed {
		join = " | "
	}

	popularity := ratingPopularitySQL
	pick := ""
	if r.popularityReady {
		popularity = releasePopularitySQL
		// Broad queries benefit from reading the most popular matching rows
		// in index order. Evaluate the full ranking only on that window.
		if common == len(r.groups) || (relaxed && common > 0) {
			pick = "ORDER BY (" + popularity + ") DESC, entity_type, mbid LIMIT 500"
		}
	}

	const nameNorm = `btrim(regexp_replace(lower(jedflix.f_unaccent(name)), '[^[:alnum:]]+', ' ', 'g'))`
	rows, err := tx.QueryContext(ctx, `
		WITH candidates AS MATERIALIZED (
			SELECT d.*, (`+popularity+`)::float8 AS pop_score
			FROM jedflix.search_documents d
			WHERE d.tsv @@ to_tsquery('simple', $1)
			`+pick+`
		), features AS (
			SELECT d.*, `+nameNorm+` AS title_norm,
			       d.tsv @@ to_tsquery('simple', $2) AS title_match,
			       COALESCE(ts_rank('{0.05,0.2,0.5,1.0}', d.tsv, to_tsquery('simple', $1), 1), 0) AS lexical,
			       CASE WHEN $5 THEN (
				       SELECT count(*) FROM unnest($4::text[]) g WHERE d.tsv @@ to_tsquery('simple', g)
			       ) ELSE 0 END AS groups_matched
			FROM candidates d
		), ranked AS (
			SELECT d.*, pop_score + LEAST(lexical * 4, 1.25)
			       + CASE WHEN title_norm = $3 THEN CASE WHEN $6 THEN 1.0 ELSE 2.6 END
			              WHEN length($3) >= 2 AND starts_with(title_norm, $3)
			              THEN CASE WHEN $6 THEN 0.25 ELSE 0.9 END
			              ELSE 0 END
			       + CASE WHEN title_match THEN CASE WHEN entity_type = 'artist' THEN 2.2 ELSE 0.9 END
			              ELSE 0 END
			       + CASE WHEN entity_type = 'artist' AND title_norm = $3 AND NOT $6 THEN 3.0
			              WHEN entity_type = 'track' THEN 0.35 ELSE 0 END AS score
			FROM features d
		)
		SELECT entity_type, mbid::text, name, artists, artist_ids::text[],
		       album_name, COALESCE(album_id::text, ''), year, duration_ms, genres, popularity,
		       score + groups_matched * 10
		FROM ranked
		ORDER BY groups_matched DESC, score DESC, popularity DESC, entity_type, mbid
		LIMIT $7
	`, strings.Join(groupQueries, join), strings.Join(titleQueries, " <-> "), r.query,
		groupQueries, relaxed, r.corrected, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHits(rows)
}

func appendUniqueHits(strict, relaxed []SearchHit, limit int) []SearchHit {
	type key struct{ entity, mbid string }
	seen := make(map[key]struct{}, len(strict))
	for _, hit := range strict {
		seen[key{hit.EntityType, hit.MBID}] = struct{}{}
	}
	for _, hit := range relaxed {
		if len(strict) >= limit {
			break
		}
		id := key{hit.EntityType, hit.MBID}
		if _, exists := seen[id]; !exists {
			// Strict hits always lead, irrespective of the fallback score.
			if len(strict) > 0 {
				hit.Fused = min(hit.Fused, strict[len(strict)-1].Fused)
			}
			strict = append(strict, hit)
			seen[id] = struct{}{}
		}
	}
	return strict
}

func isQueryTimeout(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "57014"
}
