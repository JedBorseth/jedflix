package local

import (
	"context"
	"database/sql"
	"math"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

const (
	commonDocumentCount = 6_000
	maxSearchTokens     = 16
	maxQueryRunes       = 256
)

var acdcAlias = regexp.MustCompile(`\bac(?:\s*/\s*|\s*)dc\b`)

type termCandidate struct {
	text   string
	weight int64
	ndoc   int
}

type searchToken struct {
	text       string
	weight     int64
	ndoc       int
	prefixDocs int
	candidates []termCandidate
}

type termGroup struct {
	lexemes []string
	prefix  bool
	ndoc    int
}

// PostgreSQL supplies the same lexemes used by the indexed vectors. It parses
// AC/DC as one lexeme, HUMBLE. as "humble", and hyphenated words as a compound
// followed by its parts. Use the parts so whitespace and hyphens can both match.
const tokenizeSQL = `
	SELECT lexeme AS token, t.ordinality::int AS position
	FROM ts_debug('simple', jedflix.f_unaccent($1)) WITH ORDINALITY AS t
	CROSS JOIN LATERAL unnest(t.lexemes) AS lexeme
	WHERE t.alias NOT IN ('asciihword', 'hword', 'numhword')
	ORDER BY t.ordinality
	LIMIT $2
`

func readSearchTokens(ctx context.Context, tx *sql.Tx, query string, dictionaryReady bool) ([]searchToken, error) {
	input := acdcAlias.ReplaceAllString(ExpandQuery(query), "ac/dc")
	var statement string
	if dictionaryReady {
		statement = `
			WITH tokens AS MATERIALIZED (` + tokenizeSQL + `),
			unique_tokens AS MATERIALIZED (SELECT DISTINCT token FROM tokens),
			frequency AS MATERIALIZED (
				SELECT token, COALESCE(weight, 0) AS weight, COALESCE(ndoc, 0) AS ndoc
				FROM unique_tokens LEFT JOIN jedflix.search_terms ON term = token COLLATE "C"
			),
			last_prefix AS (
				SELECT LEAST(COALESCE(sum(ndoc), 0), 2147483647)::int AS ndoc
				FROM jedflix.search_terms
				WHERE term >= (SELECT token FROM tokens ORDER BY position DESC LIMIT 1)
				  AND term < (SELECT token || chr(1114111) FROM tokens ORDER BY position DESC LIMIT 1)
			),
			corrections AS MATERIALIZED (
				SELECT f.token, c.term, c.weight, c.ndoc
				FROM frequency f
				CROSS JOIN LATERAL (
					SELECT term, weight, ndoc
					FROM jedflix.search_terms
					WHERE length(f.token) BETWEEN 2 AND 40
					  AND term % f.token AND term <> f.token
					  AND weight > GREATEST(20, 20 * f.weight)
					  AND abs(length(term) - length(f.token)) <= CASE WHEN length(f.token) <= 4 THEN 1 ELSE 2 END
					ORDER BY similarity(term, f.token) DESC, weight DESC, term
					LIMIT 40
				) c
			)
			SELECT t.position, t.token, f.weight, f.ndoc,
			       CASE WHEN t.position = (SELECT max(position) FROM tokens)
			           THEN (SELECT ndoc FROM last_prefix) ELSE 0 END,
			       COALESCE(c.term, ''), COALESCE(c.weight, 0), COALESCE(c.ndoc, 0)
			FROM tokens t JOIN frequency f USING (token)
			LEFT JOIN corrections c USING (token)
			ORDER BY t.position
		`
	} else {
		statement = `SELECT position, token, 0, 0, 0, '', 0, 0 FROM (` + tokenizeSQL + `) t ORDER BY position`
	}
	rows, err := tx.QueryContext(ctx, statement, input, maxSearchTokens)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tokens := make([]searchToken, 0, maxSearchTokens)
	lastPosition := 0
	for rows.Next() {
		var position int
		var token searchToken
		var candidate termCandidate
		if err := rows.Scan(&position, &token.text, &token.weight, &token.ndoc, &token.prefixDocs,
			&candidate.text, &candidate.weight, &candidate.ndoc); err != nil {
			return nil, err
		}
		if position != lastPosition {
			tokens = append(tokens, token)
			lastPosition = position
		}
		if candidate.text != "" {
			tokens[len(tokens)-1].candidates = append(tokens[len(tokens)-1].candidates, candidate)
		}
	}
	return tokens, rows.Err()
}

func chooseCorrections(token searchToken) []termCandidate {
	type scored struct {
		termCandidate
		score float64
	}
	var accepted []scored
	maxDistance := 2
	if utf8.RuneCountInString(token.text) <= 4 {
		maxDistance = 1
	}
	for _, candidate := range token.candidates {
		if candidate.text == token.text || candidate.weight <= max(20, 20*token.weight) {
			continue
		}
		distance := damerauLevenshtein(token.text, candidate.text)
		if distance > maxDistance {
			continue
		}
		accepted = append(accepted, scored{candidate, math.Log1p(float64(candidate.weight)) - 3*float64(distance)})
	}
	slices.SortFunc(accepted, func(a, b scored) int {
		if a.score > b.score {
			return -1
		}
		if a.score < b.score {
			return 1
		}
		return strings.Compare(a.text, b.text)
	})
	result := make([]termCandidate, 0, min(2, len(accepted)))
	for _, candidate := range accepted[:min(2, len(accepted))] {
		result = append(result, candidate.termCandidate)
	}
	return result
}

func buildTermGroups(tokens []searchToken) (groups []termGroup, corrected bool) {
	for i, token := range tokens {
		prefix := i == len(tokens)-1 && utf8.RuneCountInString(token.text) >= 2
		group := termGroup{prefix: prefix, ndoc: token.ndoc, lexemes: []string{token.text}}
		if prefix {
			group.ndoc = max(group.ndoc, token.prefixDocs)
		}
		for _, candidate := range chooseCorrections(token) {
			group.lexemes = append(group.lexemes, candidate.text)
			group.ndoc += candidate.ndoc
			corrected = true
		}
		groups = append(groups, group)
	}
	return groups, corrected
}

var tsqueryEscaper = strings.NewReplacer(`\`, `\\`, "'", "''")

func (g termGroup) tsquery(weight string) string {
	terms := make([]string, 0, len(g.lexemes))
	for i, lexeme := range g.lexemes {
		modifiers := weight
		if i == 0 && g.prefix {
			modifiers += "*"
		}
		term := "'" + tsqueryEscaper.Replace(lexeme) + "'"
		if modifiers != "" {
			term += ":" + modifiers
		}
		terms = append(terms, term)
	}
	return "(" + strings.Join(terms, " | ") + ")"
}

// damerauLevenshtein computes edit distance on Unicode code points, including
// adjacent transpositions, using the last occurrence of each code point.
func damerauLevenshtein(from, to string) int {
	a, b := []rune(from), []rune(to)
	infinity := len(a) + len(b)
	stride := len(b) + 2
	matrix := make([]int, (len(a)+2)*stride)
	matrix[0] = infinity
	for i := range len(a) + 1 {
		matrix[(i+1)*stride] = infinity
		matrix[(i+1)*stride+1] = i
	}
	for j := range len(b) + 1 {
		matrix[j+1] = infinity
		matrix[stride+j+1] = j
	}
	lastRow := make(map[rune]int, len(a))
	for i, left := range a {
		lastColumn := 0
		for j, right := range b {
			row, column := lastRow[right], lastColumn
			cost := 1
			if left == right {
				cost = 0
				lastColumn = j + 1
			}
			matrix[(i+2)*stride+j+2] = min(
				matrix[(i+1)*stride+j+1]+cost,
				matrix[(i+2)*stride+j+1]+1,
				matrix[(i+1)*stride+j+2]+1,
				matrix[row*stride+column]+(i-row)+1+(j-column),
			)
		}
		lastRow[left] = i + 1
	}
	return matrix[(len(a)+1)*stride+len(b)+1]
}
