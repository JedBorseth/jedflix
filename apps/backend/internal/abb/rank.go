package abb

import (
	"sort"
	"strings"
	"unicode"
)

type RankedResult struct {
	SearchResult
	Score float64 `json:"score"` // lower is better (0 = exact-ish)
}

// RankResults scores ABB hits against a title (+ optional author) query.
// Score is a simple token overlap distance in [0, 1]; lower is better.
func RankResults(results []SearchResult, title, author string, limit int) []RankedResult {
	needle := normalizeTokens(title + " " + author)
	if len(needle) == 0 {
		out := make([]RankedResult, 0, len(results))
		for _, r := range results {
			out = append(out, RankedResult{SearchResult: r, Score: 1})
		}
		if limit > 0 && len(out) > limit {
			out = out[:limit]
		}
		return out
	}

	ranked := make([]RankedResult, 0, len(results))
	for _, result := range results {
		hay := normalizeTokens(result.Title)
		score := tokenDistance(needle, hay)
		if score > 0.55 {
			continue
		}
		ranked = append(ranked, RankedResult{SearchResult: result, Score: score})
	}

	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].Score == ranked[j].Score {
			return ranked[i].Title < ranked[j].Title
		}
		return ranked[i].Score < ranked[j].Score
	})

	if limit > 0 && len(ranked) > limit {
		ranked = ranked[:limit]
	}
	return ranked
}

func normalizeTokens(value string) []string {
	lower := strings.ToLower(value)
	var b strings.Builder
	for _, r := range lower {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	parts := strings.Fields(b.String())
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if len(part) <= 1 {
			continue
		}
		switch part {
		case "the", "and", "for", "with", "from", "audiobook", "unabridged", "abridged":
			continue
		}
		out = append(out, part)
	}
	return out
}

func tokenDistance(needle, hay []string) float64 {
	if len(needle) == 0 {
		return 1
	}
	haySet := map[string]struct{}{}
	for _, t := range hay {
		haySet[t] = struct{}{}
	}
	matched := 0
	for _, t := range needle {
		if _, ok := haySet[t]; ok {
			matched++
		}
	}
	ratio := float64(matched) / float64(len(needle))
	return 1 - ratio
}
