package local

import (
	"strings"
	"unicode"
)

// Well-known music abbreviations that FTS will not expand on its own.
// Semantic embeddings still see the original query.
var queryAliases = map[string]string{
	"tpab":             "to pimp a butterfly kendrick lamar",
	"gkmc":             "good kid m.a.a.d city kendrick lamar",
	"mmatbs":           "mr morale and the big steppers kendrick lamar",
	"mbdtf":            "my beautiful dark twisted fantasy kanye west",
	"yeezus":           "yeezus kanye west",
	"cd":               "college dropout kanye west",
	"lateregistration": "late registration kanye west",
	"mj":               "michael jackson",
	"mjq":              "modern jazz quartet",
	"bts":              "bts bangtan",
	"lotr":             "lord of the rings",
	"got":              "game of thrones",
}

// ExpandQuery rewrites short aliases for Postgres FTS/trigram matching.
func ExpandQuery(query string) string {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	if exp, ok := queryAliases[compactAliasKey(lower)]; ok {
		return exp
	}
	fields := strings.Fields(lower)
	out := make([]string, 0, len(fields)+4)
	for _, token := range fields {
		key := compactAliasKey(token)
		if exp, ok := queryAliases[key]; ok {
			out = append(out, exp)
			continue
		}
		out = append(out, token)
	}
	return strings.Join(out, " ")
}

func compactAliasKey(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

func NormalizeSearchText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	b.Grow(len(value))
	prevSpace := true
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
			prevSpace = false
			continue
		}
		if !prevSpace {
			b.WriteByte(' ')
			prevSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}

var lexicalStopwords = map[string]struct{}{
	"a": {}, "an": {}, "and": {}, "for": {}, "in": {}, "of": {}, "on": {}, "or": {}, "the": {}, "to": {},
}

// FuzzyToken returns the longest non-stopword token when it is distinctive
// enough for pg_trgm. Empty means skip % / %> (short or stopword-heavy queries).
func FuzzyToken(query string) string {
	longest := ""
	for _, token := range strings.Fields(NormalizeSearchText(query)) {
		if _, stop := lexicalStopwords[token]; stop {
			continue
		}
		if len(token) > len(longest) {
			longest = token
		}
	}
	if len(longest) < 5 {
		return ""
	}
	return longest
}

// UseFuzzyTrigram is true when trigram % / %> will not explode on common tokens.
func UseFuzzyTrigram(query string) bool {
	return FuzzyToken(query) != ""
}
