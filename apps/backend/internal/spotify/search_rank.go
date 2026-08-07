package spotify

import (
	"regexp"
	"sort"
	"strings"
)

var nonAlnumPattern = regexp.MustCompile(`[^a-z0-9]+`)

// Spotify search responses do not include a relevance score. Rank locally so
// exact / prefix title matches beat popularity-only ordering.
func sortSearchByRelevance(query string, result *SearchResponse) {
	if result == nil {
		return
	}
	sort.SliceStable(result.Albums, func(i, j int) bool {
		si := scoreNameMatch(query, result.Albums[i].Name, result.Albums[i].Popularity)
		sj := scoreNameMatch(query, result.Albums[j].Name, result.Albums[j].Popularity)
		return si > sj
	})
	sort.SliceStable(result.Artists, func(i, j int) bool {
		si := scoreNameMatch(query, result.Artists[i].Name, result.Artists[i].Popularity)
		sj := scoreNameMatch(query, result.Artists[j].Name, result.Artists[j].Popularity)
		return si > sj
	})
	sort.SliceStable(result.Tracks, func(i, j int) bool {
		si := scoreNameMatch(query, result.Tracks[i].Name, 0)
		sj := scoreNameMatch(query, result.Tracks[j].Name, 0)
		return si > sj
	})
}

func scoreNameMatch(query, name string, popularity int) int {
	q := normalizeSearchText(query)
	n := normalizeSearchText(name)
	pop := clampPopularity(popularity)
	if q == "" || n == "" {
		return pop
	}
	if n == q {
		return 10000 + pop
	}
	if strings.HasPrefix(n, q+" ") || strings.HasPrefix(n, q) {
		return 8000 + pop
	}
	if strings.Contains(n, " "+q+" ") || strings.HasSuffix(n, " "+q) {
		return 6500 + pop
	}
	if strings.Contains(n, q) {
		return 5500 + pop
	}

	queryTokens := filterShortTokens(strings.Fields(q))
	if len(queryTokens) > 1 {
		nameTokenSet := make(map[string]struct{})
		for _, token := range strings.Fields(n) {
			nameTokenSet[token] = struct{}{}
		}
		hits := 0
		for _, token := range queryTokens {
			if _, ok := nameTokenSet[token]; ok || strings.Contains(n, token) {
				hits++
			}
		}
		if hits == len(queryTokens) {
			return 4000 + pop + hits*10
		}
		if hits > 0 {
			return 1500 + pop + hits*20
		}
	}
	return pop
}

func normalizeSearchText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = nonAlnumPattern.ReplaceAllString(value, " ")
	return strings.Join(strings.Fields(value), " ")
}

func filterShortTokens(tokens []string) []string {
	out := make([]string, 0, len(tokens))
	for _, token := range tokens {
		if len(token) > 1 {
			out = append(out, token)
		}
	}
	return out
}

func clampPopularity(popularity int) int {
	if popularity <= 0 {
		return 0
	}
	if popularity > 100 {
		return 100
	}
	return popularity
}
