package resolver

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/bookchapters"
)

type chapterFinder interface {
	Find(ctx context.Context, lookup bookchapters.Lookup) *bookchapters.Result
}

// Packs with many files are already split by chapter; only books in a few
// long files need markers from inside them.
const maxChapterProbeFiles = 4

// attachChapters adds in-file chapters to single- and few-file audiobooks.
// It never fails a resolve: a book without markers plays as before.
func (s *Service) attachChapters(
	ctx context.Context,
	hash string,
	req ResolveRequest,
	files []StreamFile,
	report func(string),
) {
	if s.chapters == nil || len(files) == 0 || len(files) > maxChapterProbeFiles {
		return
	}
	report("Reading chapter markers…")
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	title := strings.TrimSpace(req.MediaTitle)
	if title == "" {
		title = strings.TrimSpace(req.Title)
	}
	var wg sync.WaitGroup
	for i := range files {
		wg.Add(1)
		go func(file *StreamFile) {
			defer wg.Done()
			key := ""
			if hash != "" {
				key = hash + ":" + strconv.Itoa(file.FileID)
			}
			result := s.chapters.Find(ctx, bookchapters.Lookup{
				Key:          key,
				URL:          file.URL,
				Title:        title,
				Author:       strings.TrimSpace(req.Author),
				AllowCatalog: len(files) == 1,
			})
			if result == nil {
				return
			}
			file.Chapters = result.Chapters
			file.ChapterSource = result.Source
		}(&files[i])
	}
	wg.Wait()
}
