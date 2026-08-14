package realdebrid

import "testing"

func TestFilterMediaFilesNaturalOrder(t *testing.T) {
	files := []TorrentFile{
		{ID: 1, Path: "/book/10 Chapter.mp3", Bytes: 10},
		{ID: 2, Path: "/book/2 Chapter.mp3", Bytes: 10},
		{ID: 3, Path: "/book/1 Chapter.mp3", Bytes: 10},
		{ID: 4, Path: "/book/readme.txt", Bytes: 1},
	}
	out := FilterMediaFiles(files, MediaKindAudiobook)
	if len(out) != 3 {
		t.Fatalf("expected 3 audio files, got %d", len(out))
	}
	if out[0].Path != "/book/1 Chapter.mp3" || out[1].Path != "/book/2 Chapter.mp3" || out[2].Path != "/book/10 Chapter.mp3" {
		t.Fatalf("bad natural order: %#v", out)
	}
}

func TestSortPlaybackOrderHarryPotterStyle(t *testing.T) {
	files := []TorrentFile{
		{ID: 16, Path: "/HP1/J.K. Rowling - Harry Potter 1 - 16 Through the Trapdoor.mp3"},
		{ID: 5, Path: "/HP1/J.K. Rowling - Harry Potter 1 - 05 Diagon Alley.mp3"},
		{ID: 6, Path: "/HP1/J.K. Rowling - Harry Potter 1 - 06 The Journey from Platform Nine and Three-Quarters.mp3"},
	}
	SortPlaybackOrder(files)
	if files[0].ID != 5 || files[1].ID != 6 || files[2].ID != 16 {
		t.Fatalf("expected chapters 5,6,16 got %#v", files)
	}
}

func TestSortPlaybackOrderDiscFolders(t *testing.T) {
	files := []TorrentFile{
		{ID: 1, Path: `Book\CD2\01.mp3`},
		{ID: 2, Path: `Book\CD1\02.mp3`},
		{ID: 3, Path: `Book\CD1\01.mp3`},
		{ID: 4, Path: `Book\CD2\02.mp3`},
	}
	SortPlaybackOrder(files)
	want := []int{3, 2, 1, 4}
	for i, id := range want {
		if files[i].ID != id {
			t.Fatalf("disc order[%d]: got id %d want %d (%#v)", i, files[i].ID, id, files)
		}
	}
}

func TestSortPlaybackLinksKeepsLinkAttached(t *testing.T) {
	files := []TorrentFile{
		{ID: 5, Path: "/book/Chapter 05.mp3"},
		{ID: 16, Path: "/book/Chapter 16.mp3"},
		{ID: 6, Path: "/book/Chapter 06.mp3"},
	}
	links := []string{"rd://05", "rd://16", "rd://06"}
	outFiles, outLinks := SortPlaybackLinks(files, links)
	if outFiles[0].ID != 5 || outFiles[1].ID != 6 || outFiles[2].ID != 16 {
		t.Fatalf("bad file order: %#v", outFiles)
	}
	if outLinks[0] != "rd://05" || outLinks[1] != "rd://06" || outLinks[2] != "rd://16" {
		t.Fatalf("links detached from files: %#v", outLinks)
	}
}

func TestAlignThenSortMatchesListeningOrder(t *testing.T) {
	all := []TorrentFile{
		{ID: 1, Path: "/HP1/05 Diagon Alley.mp3"},
		{ID: 2, Path: "/HP1/16 Through the Trapdoor.mp3"},
		{ID: 3, Path: "/HP1/16b Through the Trapdoor.mp3"},
		{ID: 4, Path: "/HP1/06 Platform Nine.mp3"},
		{ID: 99, Path: "/HP1/readme.txt"},
	}
	selected := FilterMediaFiles(all, MediaKindAudiobook)
	aligned := AlignSelectedWithLinks(all, selected)
	if aligned[0].ID != 1 || aligned[1].ID != 2 || aligned[2].ID != 3 || aligned[3].ID != 4 {
		t.Fatalf("RD link order should follow torrent list, got %#v", aligned)
	}
	links := []string{"rd://05", "rd://16a", "rd://16b", "rd://06"}
	out, outLinks := SortPlaybackLinks(aligned, links)
	if out[0].ID != 1 || out[1].ID != 4 || out[2].ID != 2 || out[3].ID != 3 {
		t.Fatalf("listening order %#v", out)
	}
	if outLinks[0] != "rd://05" || outLinks[1] != "rd://06" || outLinks[2] != "rd://16a" || outLinks[3] != "rd://16b" {
		t.Fatalf("links %#v", outLinks)
	}
}

func TestClassifyPack(t *testing.T) {
	single := ClassifyPack([]TorrentFile{{ID: 1, Path: "book.m4b", Bytes: 200_000_000}})
	if single != PackSingle {
		t.Fatalf("expected single, got %s", single)
	}

	chapters := ClassifyPack([]TorrentFile{
		{ID: 1, Path: "Chapter 01.mp3", Bytes: 5_000_000},
		{ID: 2, Path: "Chapter 02.mp3", Bytes: 5_000_000},
		{ID: 3, Path: "Chapter 03.mp3", Bytes: 5_000_000},
		{ID: 4, Path: "Chapter 04.mp3", Bytes: 5_000_000},
		{ID: 5, Path: "Chapter 05.mp3", Bytes: 5_000_000},
	})
	if chapters != PackChapters {
		t.Fatalf("expected chapters, got %s", chapters)
	}

	series := ClassifyPack([]TorrentFile{
		{ID: 1, Path: "Book 1.m4b", Bytes: 120_000_000},
		{ID: 2, Path: "Book 2.m4b", Bytes: 130_000_000},
		{ID: 3, Path: "Book 3.m4b", Bytes: 140_000_000},
	})
	if series != PackSeries {
		t.Fatalf("expected series, got %s", series)
	}
}

func TestPreferEbookFiles(t *testing.T) {
	files := []TorrentFile{
		{ID: 1, Path: "book.pdf", Bytes: 10},
		{ID: 2, Path: "book.epub", Bytes: 5},
		{ID: 3, Path: "book.mobi", Bytes: 20},
	}
	out := PreferEbookFiles(files)
	if out[0].Path != "book.epub" {
		t.Fatalf("expected epub first, got %s", out[0].Path)
	}
}
