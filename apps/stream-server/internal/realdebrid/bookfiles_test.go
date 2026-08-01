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
