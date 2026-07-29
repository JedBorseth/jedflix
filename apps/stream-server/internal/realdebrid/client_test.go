package realdebrid

import "testing"

func TestIsInfringingError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "legal reasons status",
			err:  &APIError{Path: "/torrents/addMagnet", StatusCode: 451, Body: `{"error":"infringing_file","error_code":35}`},
			want: true,
		},
		{
			name: "error code with spacing",
			err:  &APIError{Path: "/unrestrict/link", StatusCode: 400, Body: `{"error_code": 35}`},
			want: true,
		},
		{
			name: "unrelated real debrid api error",
			err:  &APIError{Path: "/torrents/addMagnet", StatusCode: 503, Body: `{"error":"temporarily_unavailable"}`},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsInfringingError(tt.err); got != tt.want {
				t.Fatalf("IsInfringingError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIsRateLimitError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "http 429",
			err:  &APIError{Path: "/torrents/addMagnet", StatusCode: 429, Body: `{"error":"too_many_requests","error_code":34}`},
			want: true,
		},
		{
			name: "error code 34",
			err:  &APIError{Path: "/torrents/info/x", StatusCode: 400, Body: `{"error_code": 34}`},
			want: true,
		},
		{
			name: "unrelated",
			err:  &APIError{Path: "/torrents/addMagnet", StatusCode: 503, Body: `{"error":"temporarily_unavailable"}`},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsRateLimitError(tt.err); got != tt.want {
				t.Fatalf("IsRateLimitError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestPickMovieFile(t *testing.T) {
	pack := []TorrentFile{
		{ID: 1, Path: "/IMDB Top 250/The.Lord.of.the.Rings.Return.of.the.King.2003.1080p.mkv", Bytes: 20_000_000_000},
		{ID: 2, Path: "/IMDB Top 250/Star.Wars.Episode.IV.A.New.Hope.1977.1080p.mp4", Bytes: 8_000_000_000},
		{ID: 3, Path: "/IMDB Top 250/readme.txt", Bytes: 100},
	}

	t.Run("matches title in multi-file pack", func(t *testing.T) {
		file, ok := PickMovieFile(pack, "Star Wars: Episode IV - A New Hope", nil)
		if !ok {
			t.Fatal("expected a match")
		}
		if file.ID != 2 {
			t.Fatalf("got file %d (%s), want Star Wars", file.ID, file.Path)
		}
	})

	t.Run("prefers fileIdx when valid", func(t *testing.T) {
		idx := 1
		file, ok := PickMovieFile(pack, "The Lord of the Rings", &idx)
		if !ok || file.ID != 2 {
			t.Fatalf("expected fileIdx override to Star Wars, got ok=%v id=%d", ok, file.ID)
		}
	})

	t.Run("refuses pack without title match", func(t *testing.T) {
		_, ok := PickMovieFile(pack, "The Matrix", nil)
		if ok {
			t.Fatal("expected no match for unrelated title in pack")
		}
	})

	t.Run("single video still works without title", func(t *testing.T) {
		files := []TorrentFile{
			{ID: 9, Path: "/Movie.2024.1080p.mp4", Bytes: 4_000_000_000},
		}
		file, ok := PickMovieFile(files, "", nil)
		if !ok || file.ID != 9 {
			t.Fatalf("expected sole video, got ok=%v id=%d", ok, file.ID)
		}
	})
}
