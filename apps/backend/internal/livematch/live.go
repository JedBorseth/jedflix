package livematch

import (
	"regexp"
	"strings"
)

// Concert bootlegs often start with a recorded date, e.g. "2009-10-06/09: Doolittle Live".
var concertDatePrefix = regexp.MustCompile(`(?i)^\d{4}[-/]\d{2}[-/]\d{2}`)

// Phrases that mark a live performance, concert, or bootleg — not songs that
// merely contain the word "live" ("Live Through This", "Live and Let Die").
var livePhrases = []string{
	"live at",
	"live from",
	"live in concert",
	"live performance",
	"live version",
	"live session",
	"live album",
	"on tour",
	"(live)",
	"[live]",
	"{live}",
	" live:",
	": live",
	"- live",
	"– live",
	"— live",
	"/live",
	" / live",
	"bootleg",
}

// LooksLikeLiveRecording reports concert/bootleg titles, not studio albums
// that happen to start with "Live".
func LooksLikeLiveRecording(text string) bool {
	lower := strings.ToLower(strings.TrimSpace(text))
	if lower == "" {
		return false
	}
	if concertDatePrefix.MatchString(lower) {
		return true
	}
	for _, phrase := range livePhrases {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return strings.HasSuffix(lower, " live")
}
