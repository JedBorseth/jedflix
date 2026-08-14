package local

import (
	"database/sql/driver"
	"fmt"
	"strconv"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/livematch"
)

// pqStringArray scans Postgres text[] / uuid[] cast to text[].
type pqStringArray []string

func (a *pqStringArray) Scan(src any) error {
	if src == nil {
		*a = []string{}
		return nil
	}
	var raw string
	switch v := src.(type) {
	case string:
		raw = v
	case []byte:
		raw = string(v)
	default:
		return fmt.Errorf("unsupported array type %T", src)
	}
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		*a = []string{}
		return nil
	}
	if raw[0] != '{' || raw[len(raw)-1] != '}' {
		return fmt.Errorf("invalid array literal: %q", raw)
	}
	inner := raw[1 : len(raw)-1]
	if inner == "" {
		*a = []string{}
		return nil
	}
	parts := splitPGArray(inner)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if strings.HasPrefix(p, `"`) && strings.HasSuffix(p, `"`) && len(p) >= 2 {
			unquoted, err := strconv.Unquote(p)
			if err == nil {
				p = unquoted
			} else {
				p = p[1 : len(p)-1]
			}
		}
		if p == "NULL" {
			continue
		}
		out = append(out, p)
	}
	*a = out
	return nil
}

func (a pqStringArray) Value() (driver.Value, error) {
	if len(a) == 0 {
		return "{}", nil
	}
	escaped := make([]string, len(a))
	for i, s := range a {
		escaped[i] = `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
	}
	return "{" + strings.Join(escaped, ",") + "}", nil
}

func splitPGArray(inner string) []string {
	var parts []string
	var b strings.Builder
	inQuotes := false
	escape := false
	for _, r := range inner {
		if escape {
			b.WriteRune(r)
			escape = false
			continue
		}
		if r == '\\' {
			b.WriteRune(r)
			escape = true
			continue
		}
		if r == '"' {
			inQuotes = !inQuotes
			b.WriteRune(r)
			continue
		}
		if r == ',' && !inQuotes {
			parts = append(parts, b.String())
			b.Reset()
			continue
		}
		b.WriteRune(r)
	}
	parts = append(parts, b.String())
	return parts
}

func mapPrimaryType(primary string) string {
	switch strings.ToLower(strings.TrimSpace(primary)) {
	case "single":
		return "single"
	case "ep":
		return "ep"
	case "broadcast":
		return "compilation"
	default:
		return "album"
	}
}

func parseYear(date string) *int {
	date = strings.TrimSpace(date)
	if len(date) < 4 {
		return nil
	}
	year, err := strconv.Atoi(date[:4])
	if err != nil || year < 1000 {
		return nil
	}
	return &year
}

func parsePositiveInt(value string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("not a positive int")
	}
	return n, nil
}

func looksLiveOrBootleg(title string) bool {
	return livematch.LooksLikeLiveRecording(title)
}
