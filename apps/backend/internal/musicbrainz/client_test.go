package musicbrainz

import "testing"

func TestNormalizeMBID(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"a74b1b7f-71a5-4011-9441-d0b5e4122711", "a74b1b7f-71a5-4011-9441-d0b5e4122711"},
		{"A74B1B7F-71A5-4011-9441-D0B5E4122711", "a74b1b7f-71a5-4011-9441-d0b5e4122711"},
		{"https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711", "a74b1b7f-71a5-4011-9441-d0b5e4122711"},
		{"https://musicbrainz.org/release-group/a74b1b7f-71a5-4011-9441-d0b5e4122711?foo=1", "a74b1b7f-71a5-4011-9441-d0b5e4122711"},
		{"4aawyAB9vmqN3uQ7FjRGTy", ""},
		{"", ""},
	}
	for _, tc := range cases {
		got := NormalizeMBID(tc.in)
		if got != tc.want {
			t.Fatalf("NormalizeMBID(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestMapPrimaryType(t *testing.T) {
	if mapPrimaryType("Single") != "single" {
		t.Fatal("expected single")
	}
	if mapPrimaryType("Album") != "album" {
		t.Fatal("expected album")
	}
}
