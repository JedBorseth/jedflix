package api

import "testing"

func TestSplitSeed(t *testing.T) {
	artist, track, id, ok := splitSeed("Radiohead|||Karma Police")
	if !ok || artist != "Radiohead" || track != "Karma Police" || id != "" {
		t.Fatalf("pair: artist=%q track=%q id=%q ok=%v", artist, track, id, ok)
	}

	artist, track, id, ok = splitSeed("Radiohead|||Karma Police|||8b3b5fa4-4ea2-4c3d-9d3a-1a0f8e8b9c11")
	if !ok || artist != "Radiohead" || track != "Karma Police" || id == "" {
		t.Fatalf("triple: artist=%q track=%q id=%q ok=%v", artist, track, id, ok)
	}

	if _, _, _, ok = splitSeed("only-one-part"); ok {
		t.Fatal("single part should fail")
	}
	if _, _, _, ok = splitSeed("|||Track"); ok {
		t.Fatal("empty artist should fail")
	}
	if _, _, _, ok = splitSeed(""); ok {
		t.Fatal("empty seed should fail")
	}
}
