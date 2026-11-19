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

func TestPickEpisodeFileUsesFileIdxHint(t *testing.T) {
	files := []TorrentFile{
		{ID: 1, Path: "Pack/01 - Pilot.mkv"},
		{ID: 2, Path: "Pack/02 - Cat in the Bag.mkv"},
		{ID: 3, Path: "Pack/03 - And the Bag's in the River.mkv"},
	}
	idx := 2
	if file, ok := PickEpisodeFile(files, 1, 3, &idx); !ok || file.ID != 3 {
		t.Fatalf("unmarked fileIdx hint: got file %d ok=%v, want 3", file.ID, ok)
	}
	marked := []TorrentFile{{ID: 1, Path: "Show.S01E02.mkv"}, {ID: 2, Path: "Show.S01E03.mkv"}}
	idx = 0
	if file, ok := PickEpisodeFile(marked, 1, 3, &idx); !ok || file.ID != 2 {
		t.Fatalf("contradicting fileIdx hint should be ignored: got file %d ok=%v", file.ID, ok)
	}
}

func TestPickEpisodeFile(t *testing.T) {
	for _, tc := range []struct {
		name   string
		paths  []string
		wantID int
	}{
		{"matching episode in pack", []string{"Show.S01E02.mp4", "Show.S01E03.mkv"}, 2},
		{"missing episode in pack", []string{"Show.S01E01.mp4", "Show.S01E02.mkv"}, 0},
		{"multiple unmarked videos", []string{"first.mp4", "second.mkv"}, 0},
		{"single conflicting episode", []string{"Show.S01E02.mp4"}, 0},
		{"single conflicting season", []string{"Show.S02E03.mp4"}, 0},
		{"conflicting parent directory", []string{"Show.S01E02/video.mp4"}, 0},
		{"matching parent directory", []string{"Show.S01E03/video.mp4"}, 1},
		{"dotted marker in pack", []string{"[S01.E02] Show - Two.mp4", "[S01.E03] Show - Three.mp4"}, 2},
		{"NxNN marker in pack", []string{"Show 1x02.mkv", "Show 1x03.mkv"}, 2},
		{"spelled-out marker in pack", []string{"Show Season 1 Episode 2.mkv", "Show Season 1 Episode 3.mkv"}, 2},
		{"codec tag is not an episode", []string{"Show.DD5.1x264.mkv"}, 1},
		{"longer conflicting episode number", []string{"Show.S01E030.mp4"}, 0},
		{"single unmarked video", []string{"video.mp4", "readme.txt"}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var files []TorrentFile
			for i, path := range tc.paths {
				files = append(files, TorrentFile{ID: i + 1, Path: path})
			}
			file, ok := PickEpisodeFile(files, 1, 3, nil)
			if file.ID != tc.wantID || ok != (tc.wantID != 0) {
				t.Fatalf("got file %d, ok=%v, want file %d", file.ID, ok, tc.wantID)
			}
		})
	}
}
