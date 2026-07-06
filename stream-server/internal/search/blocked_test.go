package search

import "testing"

const rdBlockedPattern = `web-dl|webrip|bdrip|hdrip|dvdrip|BluRay\.x264|HDTV\.x264|HDTV\.XviD|WEB\.x264|WEB\.h264`

func TestIsRDBlockedFilename(t *testing.T) {
	tests := []struct {
		name  string
		title string
		want  bool
	}{
		{name: "web dl substring", title: "Movie.2024.1080p.WEB-DL.DDP5.1", want: true},
		{name: "dot adjacency source codec", title: "Movie.2024.1080p.BluRay.x264-GROUP", want: true},
		{name: "case insensitive", title: "Show.S01E01.HDTV.XVID", want: true},
		{name: "hyphen breaks adjacency", title: "Movie.2024.1080p.Blu-Ray.x264-GROUP", want: false},
		{name: "web hyphen rip not substring", title: "Movie.2024.1080p.WEB-Rip.x265", want: false},
		{name: "safe label", title: "Movie.2024.1080p.Remux.HEVC", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsRDBlockedFilename(tt.title, rdBlockedPattern); got != tt.want {
				t.Fatalf("IsRDBlockedFilename(%q) = %v, want %v", tt.title, got, tt.want)
			}
		})
	}
}
