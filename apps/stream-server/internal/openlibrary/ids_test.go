package openlibrary

import "testing"

func TestNormalizeIDs(t *testing.T) {
	if got := NormalizeWorkID("/works/OL82563W"); got != "OL82563W" {
		t.Fatalf("NormalizeWorkID = %q", got)
	}
	if got := NormalizeAuthorID("/authors/OL23919A"); got != "OL23919A" {
		t.Fatalf("NormalizeAuthorID = %q", got)
	}
	if got := NormalizeWorkID("bad"); got != "" {
		t.Fatalf("expected empty work id, got %q", got)
	}
}
