package local

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

const (
	defaultTextLimit   = 24
	defaultVectorLimit = 24
	mergedCandidateCap = 48
	rrfK               = 60
)

type SearchHit struct {
	EntityType string
	MBID       string
	Name       string
	Artists    []string
	ArtistIDs  []string
	AlbumName  string
	AlbumID    string
	Year       *int
	DurationMs int
	Genres     []string
	EmbedText  string
	Popularity int
	Lexical    float64
	Vector     float64
	Fused      float64
}

type HybridResult struct {
	Artists []musiccatalog.Artist
	Albums  []musiccatalog.Album
	Tracks  []musiccatalog.TopTrack
	Ranked  []RankedHit
	Hits    []SearchHit
}

type RankedHit struct {
	Kind  string  `json:"kind"`
	ID    string  `json:"id"`
	Score float64 `json:"score"`
}

func (s *Store) HybridSearch(ctx context.Context, query string, queryVec []float32, limitPerType int) (*HybridResult, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	if limitPerType <= 0 {
		limitPerType = 12
	}
	expanded := ExpandQuery(query)
	textHits, err := s.searchText(ctx, expanded, defaultTextLimit)
	if err != nil {
		return nil, err
	}
	var vecHits []SearchHit
	if len(queryVec) == EmbeddingDim {
		// Vector recall is best-effort: a partial embedding backfill, empty
		// table, or GPU hiccup must not block lexical search.
		if hits, vecErr := s.searchVector(ctx, queryVec, defaultVectorLimit); vecErr == nil {
			vecHits = hits
		}
	}
	merged := MergeHits(query, textHits, vecHits, mergedCandidateCap)
	return HitsToResult(merged, limitPerType), nil
}

func (s *Store) searchText(ctx context.Context, query string, limit int) ([]SearchHit, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("%w: text search: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer func() { _ = tx.Rollback() }()
	// Indexed pg_trgm operators only — word_similarity() in WHERE seq-scans the table.
	if _, err := tx.ExecContext(ctx, `SET LOCAL pg_trgm.word_similarity_threshold = 0.55`); err != nil {
		return nil, fmt.Errorf("%w: text search: %v", musiccatalog.ErrFetchFailed, err)
	}
	if _, err := tx.ExecContext(ctx, `SET LOCAL statement_timeout = '8s'`); err != nil {
		return nil, fmt.Errorf("%w: text search: %v", musiccatalog.ErrFetchFailed, err)
	}
	fuzzy := FuzzyToken(query)
	rows, err := tx.QueryContext(ctx, `
		WITH q AS (
			SELECT
				jedflix.safe_websearch($1) AS tsq,
				lower(jedflix.f_unaccent($1)) AS qnorm,
				lower(jedflix.f_unaccent($2)) AS fuzzy
		)
		SELECT d.entity_type, d.mbid::text, d.name, d.artists, d.artist_ids::text[],
			d.album_name, COALESCE(d.album_id::text, ''), d.year, d.duration_ms,
			d.genres, d.embed_text, d.popularity,
			COALESCE(ts_rank_cd(d.tsv, q.tsq), 0) AS ts_rank,
			COALESCE(word_similarity(q.qnorm, d.name_norm), 0) AS trgm
		FROM jedflix.search_documents d, q
		WHERE (
			(q.tsq <> ''::tsquery AND d.tsv @@ q.tsq)
			OR d.name_norm LIKE q.qnorm || '%'
			OR (q.fuzzy <> '' AND (d.name_norm % q.fuzzy OR d.name_norm %> q.fuzzy))
		)
		ORDER BY
			(COALESCE(ts_rank_cd(d.tsv, q.tsq), 0) * 2
				+ COALESCE(word_similarity(q.qnorm, d.name_norm), 0)
				+ LEAST(d.popularity, 100)::float / 400) DESC,
			d.popularity DESC
		LIMIT $3
	`, query, fuzzy, limit*3)
	if err != nil {
		return nil, fmt.Errorf("%w: text search: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()
	hits, err := scanHits(rows, "lexical")
	if err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("%w: text search: %v", musiccatalog.ErrFetchFailed, err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("%w: text search: %v", musiccatalog.ErrFetchFailed, err)
	}
	return hits, nil
}

func (s *Store) searchVector(ctx context.Context, queryVec []float32, limit int) ([]SearchHit, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("%w: vector search: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `SET LOCAL statement_timeout = '4s'`); err != nil {
		return nil, fmt.Errorf("%w: vector search: %v", musiccatalog.ErrFetchFailed, err)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT d.entity_type, d.mbid::text, d.name, d.artists, d.artist_ids::text[],
			d.album_name, COALESCE(d.album_id::text, ''), d.year, d.duration_ms,
			d.genres, d.embed_text, d.popularity,
			1 - (e.embedding <=> $1::halfvec) AS vec_score,
			0::float AS unused
		FROM jedflix.music_embeddings e
		JOIN jedflix.search_documents d
			ON d.entity_type = e.entity_type AND d.mbid = e.mbid
		ORDER BY e.embedding <=> $1::halfvec
		LIMIT $2
	`, formatHalfvec(queryVec), limit*3)
	if err != nil {
		return nil, fmt.Errorf("%w: vector search: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()
	hits, err := scanHits(rows, "vector")
	if err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("%w: vector search: %v", musiccatalog.ErrFetchFailed, err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("%w: vector search: %v", musiccatalog.ErrFetchFailed, err)
	}
	return hits, nil
}

func scanHits(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}, kind string) ([]SearchHit, error) {
	out := make([]SearchHit, 0, 32)
	for rows.Next() {
		var (
			hit                SearchHit
			artists, artistIDs pqStringArray
			genres             pqStringArray
			albumID            string
			year               sql.NullInt64
			scoreA, scoreB     float64
		)
		if err := rows.Scan(
			&hit.EntityType, &hit.MBID, &hit.Name, &artists, &artistIDs,
			&hit.AlbumName, &albumID, &year, &hit.DurationMs, &genres, &hit.EmbedText,
			&hit.Popularity, &scoreA, &scoreB,
		); err != nil {
			return nil, fmt.Errorf("%w: scan search: %v", musiccatalog.ErrFetchFailed, err)
		}
		hit.Artists = []string(artists)
		hit.ArtistIDs = []string(artistIDs)
		hit.Genres = []string(genres)
		hit.AlbumID = albumID
		if year.Valid {
			y := int(year.Int64)
			hit.Year = &y
		}
		if kind == "vector" {
			hit.Vector = scoreA
		} else {
			hit.Lexical = scoreA*2 + scoreB
		}
		out = append(out, hit)
	}
	return out, rows.Err()
}

// MergeHits fuses lexical and vector lists with RRF and exact-match boosts.
func MergeHits(query string, text, vec []SearchHit, limit int) []SearchHit {
	if limit <= 0 {
		limit = mergedCandidateCap
	}
	normQuery := NormalizeSearchText(query)
	type acc struct {
		hit   SearchHit
		textR int
		vecR  int
	}
	byKey := map[string]*acc{}
	order := make([]string, 0, len(text)+len(vec))

	add := func(hits []SearchHit, from string) {
		for i, hit := range hits {
			key := hit.EntityType + ":" + hit.MBID
			item, ok := byKey[key]
			if !ok {
				item = &acc{hit: hit, textR: -1, vecR: -1}
				byKey[key] = item
				order = append(order, key)
			} else {
				if hit.Name != "" {
					item.hit.Name = hit.Name
				}
				if len(hit.Artists) > 0 {
					item.hit.Artists = hit.Artists
				}
				if hit.EmbedText != "" {
					item.hit.EmbedText = hit.EmbedText
				}
				if hit.Popularity > item.hit.Popularity {
					item.hit.Popularity = hit.Popularity
				}
				if hit.Lexical > item.hit.Lexical {
					item.hit.Lexical = hit.Lexical
				}
				if hit.Vector > item.hit.Vector {
					item.hit.Vector = hit.Vector
				}
			}
			rank := i + 1
			if from == "text" {
				item.textR = rank
			} else {
				item.vecR = rank
			}
		}
	}
	add(text, "text")
	add(vec, "vec")

	merged := make([]SearchHit, 0, len(byKey))
	for _, key := range order {
		item := byKey[key]
		fused := 0.0
		if item.textR > 0 {
			fused += 1.0 / float64(rrfK+item.textR)
		}
		if item.vecR > 0 {
			fused += 1.0 / float64(rrfK+item.vecR)
		}
		nameNorm := NormalizeSearchText(item.hit.Name)
		if nameNorm != "" && nameNorm == normQuery {
			fused += 0.35
		} else if nameNorm != "" && strings.HasPrefix(nameNorm, normQuery) && len(normQuery) >= 3 {
			fused += 0.18
		}
		pop := item.hit.Popularity
		if pop > 100 {
			pop = 100
		}
		if pop > 0 {
			fused += float64(pop) / 400.0
		}
		// Multi-token: require all tokens to appear across name+artists.
		tokens := strings.Fields(normQuery)
		if len(tokens) > 1 {
			blob := nameNorm + " " + NormalizeSearchText(strings.Join(item.hit.Artists, " "))
			hits := 0
			for _, token := range tokens {
				if strings.Contains(blob, token) {
					hits++
				}
			}
			if hits == len(tokens) {
				fused += 0.22
			}
		}
		item.hit.Fused = fused
		merged = append(merged, item.hit)
	}
	sort.SliceStable(merged, func(i, j int) bool {
		if merged[i].Fused != merged[j].Fused {
			return merged[i].Fused > merged[j].Fused
		}
		return merged[i].Lexical > merged[j].Lexical
	})
	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged
}

func HitsToResult(hits []SearchHit, limitPerType int) *HybridResult {
	out := &HybridResult{
		Artists: []musiccatalog.Artist{},
		Albums:  []musiccatalog.Album{},
		Tracks:  []musiccatalog.TopTrack{},
		Ranked:  []RankedHit{},
		Hits:    hits,
	}
	seenType := map[string]int{}
	for _, hit := range hits {
		kindCount := seenType[hit.EntityType]
		ranked := RankedHit{Kind: mapKind(hit.EntityType), ID: hit.MBID, Score: hit.Fused}
		switch hit.EntityType {
		case "artist":
			if kindCount >= limitPerType {
				continue
			}
			out.Artists = append(out.Artists, musiccatalog.Artist{
				ID:         hit.MBID,
				Name:       hit.Name,
				Genres:     hit.Genres,
				Popularity: clampPop(hit.Fused),
			})
			out.Ranked = append(out.Ranked, ranked)
			seenType[hit.EntityType]++
		case "album":
			if kindCount >= limitPerType {
				continue
			}
			out.Albums = append(out.Albums, musiccatalog.Album{
				ID:         hit.MBID,
				Name:       hit.Name,
				Artists:    hit.Artists,
				ArtistIDs:  hit.ArtistIDs,
				Year:       hit.Year,
				AlbumType:  "album",
				Genres:     hit.Genres,
				Popularity: clampPop(hit.Fused),
			})
			out.Ranked = append(out.Ranked, ranked)
			seenType[hit.EntityType]++
		case "track":
			if kindCount >= limitPerType {
				continue
			}
			out.Tracks = append(out.Tracks, musiccatalog.TopTrack{
				ID:         hit.MBID,
				Name:       hit.Name,
				Artists:    hit.Artists,
				ArtistIDs:  hit.ArtistIDs,
				DurationMs: hit.DurationMs,
				AlbumID:    hit.AlbumID,
				AlbumName:  hit.AlbumName,
			})
			out.Ranked = append(out.Ranked, ranked)
			seenType[hit.EntityType]++
		}
	}
	return out
}

func mapKind(entityType string) string {
	switch entityType {
	case "album":
		return "album"
	case "artist":
		return "artist"
	default:
		return "track"
	}
}

func clampPop(fused float64) int {
	n := int(fused * 400)
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

func HitEmbedText(hit SearchHit) string {
	if strings.TrimSpace(hit.EmbedText) != "" {
		return hit.EmbedText
	}
	return DocumentText(hit.EntityType, hit.Name, hit.Artists, hit.AlbumName, hit.Year, hit.Genres, nil)
}
