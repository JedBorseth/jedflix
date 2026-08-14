package realdebrid

import (
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

type MediaKind string

const (
	MediaKindAudiobook MediaKind = "audiobook"
	MediaKindEbook     MediaKind = "ebook"
)

type PackKind string

const (
	PackSingle   PackKind = "single"
	PackChapters PackKind = "chapters"
	PackSeries   PackKind = "series"
)

var (
	audioExts = map[string]struct{}{
		".m4b": {}, ".mp3": {}, ".m4a": {}, ".flac": {}, ".aac": {}, ".ogg": {}, ".opus": {},
	}
	ebookExts = map[string]struct{}{
		".epub": {}, ".pdf": {}, ".mobi": {}, ".azw3": {}, ".azw": {},
	}
	chapterNameRE = regexp.MustCompile(`(?i)(^|[^a-z0-9])(ch(apter)?|track|disc|cd|part|pt)[\s._-]*\d+`)
	leadingNumRE  = regexp.MustCompile(`(?i)^(?:\d{1,3}|[a-z]?\d{1,3})[\s._-]+`)
)

// FilterMediaFiles returns torrent files matching the requested book media kind,
// sorted in playback order (natural full-path comparison).
func FilterMediaFiles(files []TorrentFile, kind MediaKind) []TorrentFile {
	out := make([]TorrentFile, 0, len(files))
	for _, file := range files {
		if MatchesMediaKind(file.Path, kind) {
			out = append(out, file)
		}
	}
	SortPlaybackOrder(out)
	return out
}

// SortPlaybackOrder sorts chapter/disc packs into listening order.
//
// Natural comparison of the full path is the conservative choice: it does not
// guess which number in a name is the chapter (titles often include a book
// number, year, or bitrate). Numeric runs compare as integers so "Chapter 2"
// precedes "Chapter 10", and folder names keep Disc 1 before Disc 2.
func SortPlaybackOrder(files []TorrentFile) {
	sort.SliceStable(files, func(i, j int) bool {
		return playbackPathLess(files[i].Path, files[j].Path)
	})
}

// AlignSelectedWithLinks returns selected files in torrent file-list order.
// Real Debrid's unrestricted links are aligned with that order, not with any
// prior sort of the selected slice.
func AlignSelectedWithLinks(allFiles, selected []TorrentFile) []TorrentFile {
	selectedSet := make(map[int]TorrentFile, len(selected))
	for _, file := range selected {
		selectedSet[file.ID] = file
	}
	out := make([]TorrentFile, 0, len(selected))
	for _, file := range allFiles {
		if _, ok := selectedSet[file.ID]; ok {
			out = append(out, file)
		}
	}
	if len(out) == 0 {
		return selected
	}
	return out
}

// SortPlaybackLinks keeps each torrent file attached to its Real Debrid link
// while sorting into listening order.
func SortPlaybackLinks(files []TorrentFile, links []string) ([]TorrentFile, []string) {
	n := len(files)
	if len(links) < n {
		n = len(links)
	}
	type pair struct {
		file TorrentFile
		link string
	}
	pairs := make([]pair, n)
	for i := 0; i < n; i++ {
		pairs[i] = pair{file: files[i], link: links[i]}
	}
	sort.SliceStable(pairs, func(i, j int) bool {
		return playbackPathLess(pairs[i].file.Path, pairs[j].file.Path)
	})
	outFiles := make([]TorrentFile, n)
	outLinks := make([]string, n)
	for i, p := range pairs {
		outFiles[i] = p.file
		outLinks[i] = p.link
	}
	return outFiles, outLinks
}

func MatchesMediaKind(path string, kind MediaKind) bool {
	ext := strings.ToLower(filepath.Ext(path))
	switch kind {
	case MediaKindAudiobook:
		_, ok := audioExts[ext]
		return ok
	case MediaKindEbook:
		_, ok := ebookExts[ext]
		return ok
	default:
		return false
	}
}

// PreferEbookFiles ranks ebook candidates: epub > pdf > others, then size.
func PreferEbookFiles(files []TorrentFile) []TorrentFile {
	if len(files) <= 1 {
		return files
	}
	sorted := append([]TorrentFile(nil), files...)
	sort.SliceStable(sorted, func(i, j int) bool {
		pi, pj := ebookPriority(sorted[i].Path), ebookPriority(sorted[j].Path)
		if pi != pj {
			return pi < pj
		}
		return sorted[i].Bytes > sorted[j].Bytes
	})
	return sorted
}

func ebookPriority(path string) int {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".epub":
		return 0
	case ".pdf":
		return 1
	case ".mobi", ".azw3", ".azw":
		return 2
	default:
		return 3
	}
}

// ClassifyPack distinguishes single-file, chapter packs, and multi-book series packs.
//
// Heuristics (ABB reality):
//   - 1 file → single
//   - Many small files / chapter-like names → chapters of one book
//   - Few large files (each roughly book-sized) → series (one book per file)
func ClassifyPack(files []TorrentFile) PackKind {
	if len(files) <= 1 {
		return PackSingle
	}

	chapterHits := 0
	largeCount := 0
	const largeBytes = 40 * 1024 * 1024 // ~40MB suggests a full book, not a short chapter
	for _, file := range files {
		name := filepath.Base(file.Path)
		if looksLikeChapter(name) {
			chapterHits++
		}
		if file.Bytes >= largeBytes {
			largeCount++
		}
	}

	// Majority large files with few chapter-like names → series set.
	if largeCount >= 2 && largeCount*2 >= len(files) && chapterHits*2 < len(files) {
		return PackSeries
	}
	if chapterHits*2 >= len(files) {
		return PackChapters
	}
	if len(files) >= 5 {
		return PackChapters
	}
	if largeCount >= 2 {
		return PackSeries
	}
	return PackChapters
}

func looksLikeChapter(name string) bool {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	if chapterNameRE.MatchString(base) {
		return true
	}
	return leadingNumRE.MatchString(base)
}

func playbackPathLess(a, b string) bool {
	return naturalLess(filepath.ToSlash(a), filepath.ToSlash(b))
}

func naturalLess(a, b string) bool {
	ai, bi := 0, 0
	for ai < len(a) && bi < len(b) {
		ca, cb := a[ai], b[bi]
		aDigit := ca >= '0' && ca <= '9'
		bDigit := cb >= '0' && cb <= '9'
		if aDigit && bDigit {
			an, aNext := readInt(a, ai)
			bn, bNext := readInt(b, bi)
			if an != bn {
				return an < bn
			}
			ai, bi = aNext, bNext
			continue
		}
		la := unicode.ToLower(rune(ca))
		lb := unicode.ToLower(rune(cb))
		if la != lb {
			return la < lb
		}
		ai++
		bi++
	}
	return len(a) < len(b)
}

func readInt(s string, i int) (int64, int) {
	start := i
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	n, _ := strconv.ParseInt(s[start:i], 10, 64)
	return n, i
}

func MimeForFilename(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".m4b", ".m4a":
		return "audio/mp4"
	case ".mp3":
		return "audio/mpeg"
	case ".flac":
		return "audio/flac"
	case ".aac":
		return "audio/aac"
	case ".ogg", ".opus":
		return "audio/ogg"
	case ".epub":
		return "application/epub+zip"
	case ".pdf":
		return "application/pdf"
	case ".mobi":
		return "application/x-mobipocket-ebook"
	default:
		return "application/octet-stream"
	}
}
