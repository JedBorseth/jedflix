package local

import (
	"slices"
	"testing"
)

func TestChooseCorrections(t *testing.T) {
	token := searchToken{
		text: "swft", weight: 3,
		candidates: []termCandidate{
			{text: "soft", weight: 7800},
			{text: "swift", weight: 4500},
			{text: "swot", weight: 400},
			{text: "salt", weight: 10000}, // Two edits on a four-letter token.
			{text: "swat", weight: 60},    // Equal to the required popularity threshold.
		},
	}
	want := []termCandidate{{text: "soft", weight: 7800}, {text: "swift", weight: 4500}}
	if got := chooseCorrections(token); !slices.Equal(got, want) {
		t.Fatalf("corrections = %v, want %v", got, want)
	}

	token = searchToken{
		text: "taylr",
		candidates: []termCandidate{
			{text: "taylor", weight: 100},
			{text: "tailor", weight: 800}, // Raw weight is higher, but it needs two edits.
			{text: "tayl", weight: 20},
		},
	}
	if got := chooseCorrections(token); len(got) != 2 || got[0].text != "taylor" || got[1].text != "tailor" {
		t.Fatalf("corrections = %v, want taylor followed by tailor", got)
	}
}

func TestBuildTermGroupsAndEscapeTSQuery(t *testing.T) {
	groups, corrected := buildTermGroups([]searchToken{
		{text: "ac/dc", ndoc: 100},
		{text: "swft", prefixDocs: 5, candidates: []termCandidate{
			{text: "soft", weight: 700, ndoc: 120},
			{text: "swift", weight: 500, ndoc: 600},
		}},
	})
	if !corrected || len(groups) != 2 || groups[1].ndoc != 725 {
		t.Fatalf("groups = %#v, corrected = %v", groups, corrected)
	}
	if got := groups[0].tsquery(""); got != "('ac/dc')" {
		t.Fatalf("first group = %q", got)
	}
	if got := groups[1].tsquery("A"); got != "('swft':A* | 'soft':A | 'swift':A)" {
		t.Fatalf("last group = %q", got)
	}
	malicious := termGroup{lexemes: []string{`a' | !'b\c`}, prefix: true}
	if got, want := malicious.tsquery(""), `('a'' | !''b\\c':*)`; got != want {
		t.Fatalf("escaped group = %q, want %q", got, want)
	}
	single, _ := buildTermGroups([]searchToken{{text: "a"}})
	if got := single[0].tsquery(""); got != "('a')" {
		t.Fatalf("single-letter group = %q", got)
	}
}

func TestDamerauLevenshtein(t *testing.T) {
	for _, tt := range []struct {
		from, to string
		distance int
	}{
		{"", "", 0},
		{"", "abc", 3},
		{"fleetwod", "fleetwood", 1},
		{"coldpaly", "coldplay", 1},
		{"beyonse", "beyonce", 1},
		{"宇多田ヒカル", "宇田多ヒカル", 1},
		{"ca", "abc", 2}, // A transposition followed by an insertion.
		{"radiohead", "radio", 4},
	} {
		if got := damerauLevenshtein(tt.from, tt.to); got != tt.distance {
			t.Errorf("distance(%q, %q) = %d, want %d", tt.from, tt.to, got, tt.distance)
		}
	}
}
