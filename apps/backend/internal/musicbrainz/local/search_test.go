package local

import (
	"strings"
	"testing"
)

func TestExpandQueryAliases(t *testing.T) {
	if got := ExpandQuery("tpab"); !strings.Contains(got, "to pimp a butterfly") {
		t.Fatalf("tpab expand = %q", got)
	}
	if got := ExpandQuery("beat it mj"); !strings.Contains(got, "michael jackson") {
		t.Fatalf("beat it mj expand = %q", got)
	}
	if got := ExpandQuery("kendric"); got != "kendric" {
		t.Fatalf("unknown token should pass through, got %q", got)
	}
	if got := ExpandQuery("Late Registration"); !strings.Contains(got, "kanye") {
		t.Fatalf("late registration expand = %q", got)
	}
}

func TestMergeHitsPrefersExactAndRRF(t *testing.T) {
	text := []SearchHit{
		{EntityType: "track", MBID: "beat-it", Name: "Beat It", Artists: []string{"Michael Jackson"}, Lexical: 4},
		{EntityType: "artist", MBID: "beatles", Name: "The Beatles", Lexical: 3},
	}
	vec := []SearchHit{
		{EntityType: "track", MBID: "beat-it", Name: "Beat It", Artists: []string{"Michael Jackson"}, Vector: 0.9},
		{EntityType: "track", MBID: "other", Name: "Let It Be", Artists: []string{"The Beatles"}, Vector: 0.8},
	}
	merged := MergeHits("beat it mj", text, vec, 10)
	if len(merged) < 2 {
		t.Fatalf("expected merged hits, got %d", len(merged))
	}
	if merged[0].MBID != "beat-it" {
		t.Fatalf("expected Beat It first, got %+v", merged[0])
	}
	allTokens := MergeHits("beat it michael jackson", text, nil, 10)
	if allTokens[0].MBID != "beat-it" {
		t.Fatalf("multi-token boost missed Beat It: %+v", allTokens[0])
	}
}

func TestDocumentText(t *testing.T) {
	year := 2015
	got := DocumentText("album", "To Pimp a Butterfly", []string{"Kendrick Lamar"}, "", &year, []string{"hip hop"}, []string{"TPAB"})
	if !strings.Contains(got, "Kendrick Lamar") || !strings.Contains(got, "TPAB") {
		t.Fatalf("unexpected document text: %s", got)
	}
}

func TestFormatHalfvec(t *testing.T) {
	got := formatHalfvec([]float32{0.5, -1, 0})
	if got != "[0.5,-1,0]" {
		t.Fatalf("formatHalfvec = %q", got)
	}
}

func TestNormalizeSearchText(t *testing.T) {
	if got := NormalizeSearchText("  Beat It! "); got != "beat it" {
		t.Fatalf("got %q", got)
	}
}
