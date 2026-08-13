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

func TestMergeHitsPrefersPopularExactTitle(t *testing.T) {
	merged := MergeHits("thriller", []SearchHit{
		{EntityType: "track", MBID: "fob", Name: "Thriller", Artists: []string{"Fall Out Boy"}, Lexical: 3, Popularity: 4},
		{EntityType: "track", MBID: "mj", Name: "Thriller", Artists: []string{"Michael Jackson"}, Lexical: 3, Popularity: 100},
	}, nil, 10)
	if merged[0].MBID != "mj" {
		t.Fatalf("expected Michael Jackson Thriller first, got %+v", merged[0])
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

func TestSearchDocumentsReadyAcceptsPartialIndex(t *testing.T) {
	if SearchDocumentsReady(0, 0, 0) {
		t.Fatal("empty index should not be ready")
	}
	if !SearchDocumentsReady(12, 0, 0) {
		t.Fatal("artist-only subset should be searchable")
	}
	if !SearchDocumentsReady(0, 3, 40) {
		t.Fatal("album+track subset should be searchable")
	}
}

func TestShouldPopulateSearchDocuments(t *testing.T) {
	if !ShouldPopulateSearchDocuments(0) || !ShouldPopulateSearchDocuments(9999) {
		t.Fatal("small indexes should still populate")
	}
	if ShouldPopulateSearchDocuments(10000) || ShouldPopulateSearchDocuments(1_500_000) {
		t.Fatal("populated catalogs must not full-rescan on embedder start")
	}
}

func TestHitsToResultKeepsTracksAlbumsArtists(t *testing.T) {
	hits := []SearchHit{
		{EntityType: "track", MBID: "t1", Name: "Song", Artists: []string{"A"}, Fused: 3},
		{EntityType: "album", MBID: "al1", Name: "LP", Artists: []string{"A"}, Fused: 2},
		{EntityType: "artist", MBID: "ar1", Name: "A", Fused: 1},
	}
	result := HitsToResult(hits, 10)
	if len(result.Tracks) != 1 || result.Tracks[0].ID != "t1" {
		t.Fatalf("tracks = %+v", result.Tracks)
	}
	if len(result.Albums) != 1 || result.Albums[0].ID != "al1" {
		t.Fatalf("albums = %+v", result.Albums)
	}
	if len(result.Artists) != 1 || result.Artists[0].ID != "ar1" {
		t.Fatalf("artists = %+v", result.Artists)
	}
	if len(result.Ranked) != 3 {
		t.Fatalf("ranked = %+v", result.Ranked)
	}
}
