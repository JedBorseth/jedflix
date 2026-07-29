package openlibrary

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
)

const (
	defaultBaseURL     = "https://openlibrary.org"
	defaultCoversBase  = "https://covers.openlibrary.org"
	fallbackCover      = "https://placehold.co/500x750/18181b/a1a1aa?text=No+Cover"
	fallbackAuthor     = "https://placehold.co/300x450/18181b/a1a1aa?text=No+Photo"
	defaultUserAgent   = "JedFlix/1.0 (https://github.com/JedBorseth/jedflix)"
	defaultLimit       = 24
	minRequestGap      = 350 * time.Millisecond
	searchFields       = "key,title,author_name,author_key,first_publish_year,cover_i,subject,number_of_pages_median"
	maxDetailCacheSize = 500
	maxAuthorCacheSize = 200
)

var (
	workIDPattern   = regexp.MustCompile(`(?i)OL\d+W`)
	authorIDPattern = regexp.MustCompile(`(?i)OL\d+A`)
)

type Client struct {
	baseURL    string
	coversBase string
	userAgent  string
	http       *http.Client
	refreshTTL time.Duration
	subjects   []SubjectRowConfig

	mu           sync.Mutex
	lastRequest  time.Time
	catalogMu    sync.RWMutex
	catalog      *BrowseResponse
	refreshing   bool
	refreshErr   error
	detailCache  sync.Map // workID -> cachedBook
	authorCache  sync.Map // authorID -> cachedAuthor
	now          func() time.Time
}

type cachedBook struct {
	book     Book
	cachedAt time.Time
}

type cachedAuthor struct {
	author   AuthorDetails
	cachedAt time.Time
}

func NewClient(cfg config.Config) *Client {
	httpClient := cfg.HTTPClient()
	httpClient.Timeout = 45 * time.Second

	baseURL := strings.TrimRight(cfg.OpenLibraryBaseURL, "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	ttl := cfg.OpenLibraryCacheTTL
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}

	return &Client{
		baseURL:    baseURL,
		coversBase: defaultCoversBase,
		userAgent:  defaultUserAgent,
		http:       httpClient,
		refreshTTL: ttl,
		subjects:   DefaultSubjectRows,
		now:        time.Now,
	}
}

func (c *Client) Start(ctx context.Context) {
	go c.refreshLoop(ctx)
}

func (c *Client) refreshLoop(ctx context.Context) {
	_ = c.Refresh(ctx)

	ticker := time.NewTicker(c.refreshTTL)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = c.Refresh(ctx)
		}
	}
}

func (c *Client) Refresh(ctx context.Context) error {
	c.catalogMu.Lock()
	if c.refreshing {
		c.catalogMu.Unlock()
		return nil
	}
	c.refreshing = true
	c.catalogMu.Unlock()

	defer func() {
		c.catalogMu.Lock()
		c.refreshing = false
		c.catalogMu.Unlock()
	}()

	trending, err := c.fetchTrending(ctx, defaultLimit)
	if err != nil {
		c.catalogMu.Lock()
		c.refreshErr = err
		c.catalogMu.Unlock()
		return err
	}

	rows := make([]SubjectRow, 0, len(c.subjects))
	for _, subject := range c.subjects {
		books, subjectErr := c.fetchSubject(ctx, subject.Subject, defaultLimit)
		if subjectErr != nil {
			// Keep partial catalog; skip failed subjects.
			continue
		}
		rows = append(rows, SubjectRow{
			Title:   subject.Title,
			Subject: subject.Subject,
			Books:   books,
		})
	}

	catalog := &BrowseResponse{
		Trending: trending,
		Rows:     rows,
		CachedAt: c.now().UnixMilli(),
	}

	c.catalogMu.Lock()
	c.catalog = catalog
	c.refreshErr = nil
	c.catalogMu.Unlock()
	return nil
}

func (c *Client) Browse(ctx context.Context) (*BrowseResponse, error) {
	c.catalogMu.RLock()
	catalog := c.catalog
	refreshErr := c.refreshErr
	c.catalogMu.RUnlock()

	if catalog != nil {
		copied := *catalog
		return &copied, nil
	}

	if err := c.Refresh(ctx); err != nil {
		return nil, err
	}

	c.catalogMu.RLock()
	defer c.catalogMu.RUnlock()
	if c.catalog == nil {
		if refreshErr != nil {
			return nil, refreshErr
		}
		return nil, fmt.Errorf("%w: catalog unavailable", ErrFetchFailed)
	}
	copied := *c.catalog
	return &copied, nil
}

func (c *Client) Search(ctx context.Context, query string) (*SearchResponse, error) {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return &SearchResponse{Books: []Book{}, Authors: []AuthorSummary{}}, nil
	}

	books, err := c.searchBooks(ctx, trimmed, defaultLimit)
	if err != nil {
		return nil, err
	}
	authors, err := c.searchAuthors(ctx, trimmed, 12)
	if err != nil {
		return nil, err
	}
	return &SearchResponse{Books: books, Authors: authors}, nil
}

func (c *Client) GetWork(ctx context.Context, workID string) (*Book, error) {
	id := NormalizeWorkID(workID)
	if id == "" {
		return nil, fmt.Errorf("%w: invalid work id", ErrBadRequest)
	}

	if cached, ok := c.detailCache.Load(id); ok {
		entry := cached.(cachedBook)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL {
			book := entry.book
			return &book, nil
		}
	}

	book, err := c.fetchWorkDetails(ctx, id)
	if err != nil {
		return nil, err
	}
	c.storeBookDetail(id, *book)
	return book, nil
}

func (c *Client) GetAuthor(ctx context.Context, authorID string) (*AuthorDetails, error) {
	id := NormalizeAuthorID(authorID)
	if id == "" {
		return nil, fmt.Errorf("%w: invalid author id", ErrBadRequest)
	}

	if cached, ok := c.authorCache.Load(id); ok {
		entry := cached.(cachedAuthor)
		if c.now().Sub(entry.cachedAt) < c.refreshTTL {
			author := entry.author
			return &author, nil
		}
	}

	author, err := c.fetchAuthorDetails(ctx, id)
	if err != nil {
		return nil, err
	}
	c.storeAuthorDetail(id, *author)
	return author, nil
}

func (c *Client) storeBookDetail(id string, book Book) {
	c.detailCache.Store(id, cachedBook{book: book, cachedAt: c.now()})
	c.evictExpired(&c.detailCache, c.refreshTTL, maxDetailCacheSize)
}

func (c *Client) storeAuthorDetail(id string, author AuthorDetails) {
	c.authorCache.Store(id, cachedAuthor{author: author, cachedAt: c.now()})
	c.evictExpired(&c.authorCache, c.refreshTTL, maxAuthorCacheSize)
}

func (c *Client) evictExpired(cache *sync.Map, ttl time.Duration, maxSize int) {
	now := c.now()
	count := 0
	cache.Range(func(key, value any) bool {
		count++
		switch entry := value.(type) {
		case cachedBook:
			if now.Sub(entry.cachedAt) >= ttl {
				cache.Delete(key)
				count--
			}
		case cachedAuthor:
			if now.Sub(entry.cachedAt) >= ttl {
				cache.Delete(key)
				count--
			}
		}
		return true
	})

	if count <= maxSize {
		return
	}

	type aged struct {
		key any
		at  time.Time
	}
	oldest := make([]aged, 0, count)
	cache.Range(func(key, value any) bool {
		switch entry := value.(type) {
		case cachedBook:
			oldest = append(oldest, aged{key: key, at: entry.cachedAt})
		case cachedAuthor:
			oldest = append(oldest, aged{key: key, at: entry.cachedAt})
		}
		return true
	})

	for i := 0; i < len(oldest); i++ {
		for j := i + 1; j < len(oldest); j++ {
			if oldest[j].at.Before(oldest[i].at) {
				oldest[i], oldest[j] = oldest[j], oldest[i]
			}
		}
	}

	overflow := count - maxSize
	for i := 0; i < overflow && i < len(oldest); i++ {
		cache.Delete(oldest[i].key)
	}
}

func (c *Client) fetchTrending(ctx context.Context, limit int) ([]Book, error) {
	var payload struct {
		Works []searchDoc `json:"works"`
	}
	if err := c.getJSON(ctx, "/trending/weekly.json", url.Values{
		"limit": {strconv.Itoa(limit)},
	}, &payload); err != nil {
		return nil, err
	}
	return normalizeSearchDocs(payload.Works), nil
}

func (c *Client) fetchSubject(ctx context.Context, subject string, limit int) ([]Book, error) {
	var payload struct {
		Works []subjectWork `json:"works"`
	}
	path := fmt.Sprintf("/subjects/%s.json", url.PathEscape(subject))
	if err := c.getJSON(ctx, path, url.Values{
		"limit": {strconv.Itoa(limit)},
	}, &payload); err != nil {
		return nil, err
	}
	return normalizeSubjectWorks(payload.Works), nil
}

func (c *Client) searchBooks(ctx context.Context, query string, limit int) ([]Book, error) {
	var payload struct {
		Docs []searchDoc `json:"docs"`
	}
	if err := c.getJSON(ctx, "/search.json", url.Values{
		"q":      {query},
		"fields": {searchFields},
		"limit":  {strconv.Itoa(limit)},
	}, &payload); err != nil {
		return nil, err
	}
	return normalizeSearchDocs(payload.Docs), nil
}

func (c *Client) searchAuthors(ctx context.Context, query string, limit int) ([]AuthorSummary, error) {
	var payload struct {
		Docs []authorSearchDoc `json:"docs"`
	}
	if err := c.getJSON(ctx, "/search/authors.json", url.Values{
		"q":     {query},
		"limit": {strconv.Itoa(limit)},
	}, &payload); err != nil {
		return nil, err
	}

	authors := make([]AuthorSummary, 0, len(payload.Docs))
	for _, doc := range payload.Docs {
		id := NormalizeAuthorID(doc.Key)
		name := strings.TrimSpace(doc.Name)
		if id == "" || name == "" {
			continue
		}
		authors = append(authors, AuthorSummary{
			ID:        id,
			Name:      name,
			PhotoURL:  authorPhotoURL(id, 0),
			TopWork:   strings.TrimSpace(doc.TopWork),
			WorkCount: doc.WorkCount,
		})
	}
	return authors, nil
}

func (c *Client) fetchWorkDetails(ctx context.Context, workID string) (*Book, error) {
	var work workResponse
	if err := c.getJSON(ctx, fmt.Sprintf("/works/%s.json", workID), nil, &work); err != nil {
		return nil, err
	}

	var searchPayload struct {
		Docs []searchDoc `json:"docs"`
	}
	_ = c.getJSON(ctx, "/search.json", url.Values{
		"q":      {fmt.Sprintf("key:/works/%s", workID)},
		"fields": {searchFields},
		"limit":  {"1"},
	}, &searchPayload)

	var searchDoc *searchDoc
	if len(searchPayload.Docs) > 0 {
		searchDoc = &searchPayload.Docs[0]
	}

	authors := []string{}
	authorKeys := []string{}
	if searchDoc != nil {
		authors = filterNonEmpty(searchDoc.AuthorName)
		for _, key := range searchDoc.AuthorKey {
			if id := NormalizeAuthorID(key); id != "" {
				authorKeys = append(authorKeys, id)
			}
		}
	}
	if len(authors) == 0 {
		for _, entry := range work.Authors {
			if id := NormalizeAuthorID(entry.Author.Key); id != "" {
				authorKeys = append(authorKeys, id)
				if name, err := c.fetchAuthorName(ctx, id); err == nil && name != "" {
					authors = append(authors, name)
				}
			}
		}
	}

	coverID := 0
	if len(work.Covers) > 0 {
		coverID = work.Covers[0]
	} else if searchDoc != nil && searchDoc.CoverI != nil {
		coverID = *searchDoc.CoverI
	}

	year := yearPtr(nil)
	if searchDoc != nil && searchDoc.FirstPublishYear != nil {
		year = searchDoc.FirstPublishYear
	} else if y := parseYear(work.FirstPublishDate); y != nil {
		year = y
	}

	subjects := uniqueStrings(append(work.Subjects, searchDocSubjects(searchDoc)...))
	if len(subjects) > 12 {
		subjects = subjects[:12]
	}

	title := strings.TrimSpace(work.Title)
	if title == "" && searchDoc != nil {
		title = strings.TrimSpace(searchDoc.Title)
	}
	if title == "" {
		title = "Untitled"
	}

	description := extractText(work.Description)
	if description == "" {
		description = "No description available."
	}

	return &Book{
		ID:          workID,
		Title:       title,
		Description: description,
		CoverURL:    coverURL(coverID),
		Authors:     authors,
		AuthorKeys:  authorKeys,
		Year:        year,
		PageCount:   pageCountFromSearch(searchDoc),
		Subjects:    subjects,
	}, nil
}

func (c *Client) fetchAuthorDetails(ctx context.Context, authorID string) (*AuthorDetails, error) {
	var author authorResponse
	if err := c.getJSON(ctx, fmt.Sprintf("/authors/%s.json", authorID), nil, &author); err != nil {
		return nil, err
	}

	works, err := c.searchBooksByAuthor(ctx, authorID, defaultLimit)
	if err != nil {
		return nil, err
	}

	photoID := 0
	if len(author.Photos) > 0 {
		photoID = author.Photos[0]
	}

	name := strings.TrimSpace(author.Name)
	if name == "" {
		name = "Unknown author"
	}
	biography := extractText(author.Bio)
	if biography == "" {
		biography = "No biography available."
	}

	workCount := len(works)
	return &AuthorDetails{
		AuthorSummary: AuthorSummary{
			ID:        authorID,
			Name:      name,
			PhotoURL:  authorPhotoURL(authorID, photoID),
			WorkCount: &workCount,
		},
		Biography: biography,
		BirthDate: strings.TrimSpace(author.BirthDate),
		Works:     works,
	}, nil
}

func (c *Client) searchBooksByAuthor(ctx context.Context, authorID string, limit int) ([]Book, error) {
	var payload struct {
		Docs []searchDoc `json:"docs"`
	}
	if err := c.getJSON(ctx, "/search.json", url.Values{
		"author_key": {authorID},
		"fields":     {searchFields},
		"limit":      {strconv.Itoa(limit)},
	}, &payload); err != nil {
		return nil, err
	}
	return normalizeSearchDocs(payload.Docs), nil
}

func (c *Client) fetchAuthorName(ctx context.Context, authorID string) (string, error) {
	var author authorResponse
	if err := c.getJSON(ctx, fmt.Sprintf("/authors/%s.json", authorID), nil, &author); err != nil {
		return "", err
	}
	return strings.TrimSpace(author.Name), nil
}

func (c *Client) getJSON(ctx context.Context, path string, query url.Values, dest any) error {
	c.mu.Lock()
	wait := minRequestGap - c.now().Sub(c.lastRequest)
	if wait > 0 {
		timer := time.NewTimer(wait)
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		c.mu.Lock()
	}
	c.lastRequest = c.now()
	c.mu.Unlock()

	endpoint := c.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "application/json")

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrFetchFailed, err)
	}

	switch res.StatusCode {
	case http.StatusOK:
		if err := json.Unmarshal(body, dest); err != nil {
			return fmt.Errorf("%w: %v", ErrFetchFailed, err)
		}
		return nil
	case http.StatusNotFound:
		return ErrNotFound
	default:
		return fmt.Errorf("%w: unexpected status %d", ErrFetchFailed, res.StatusCode)
	}
}

type openLibraryText struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

func (t *openLibraryText) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return nil
	}
	if len(data) > 0 && data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		t.Value = s
		return nil
	}
	type alias openLibraryText
	var raw alias
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*t = openLibraryText(raw)
	return nil
}

type subjectWork struct {
	Key              string `json:"key"`
	Title            string `json:"title"`
	CoverID          *int   `json:"cover_id"`
	FirstPublishYear *int   `json:"first_publish_year"`
	Subject          []string `json:"subject"`
	Authors          []struct {
		Key  string `json:"key"`
		Name string `json:"name"`
	} `json:"authors"`
}

type searchDoc struct {
	Key                  string   `json:"key"`
	Title                string   `json:"title"`
	AuthorName           []string `json:"author_name"`
	AuthorKey            []string `json:"author_key"`
	FirstPublishYear     *int     `json:"first_publish_year"`
	CoverI               *int     `json:"cover_i"`
	Subject              []string `json:"subject"`
	NumberOfPagesMedian  *int     `json:"number_of_pages_median"`
}

type authorSearchDoc struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	TopWork   string `json:"top_work"`
	WorkCount *int   `json:"work_count"`
}

type workResponse struct {
	Key              string          `json:"key"`
	Title            string          `json:"title"`
	Description      openLibraryText `json:"description"`
	Covers           []int           `json:"covers"`
	Subjects         []string        `json:"subjects"`
	FirstPublishDate string          `json:"first_publish_date"`
	Authors          []struct {
		Author struct {
			Key string `json:"key"`
		} `json:"author"`
	} `json:"authors"`
}

type authorResponse struct {
	Key       string          `json:"key"`
	Name      string          `json:"name"`
	Bio       openLibraryText `json:"bio"`
	BirthDate string          `json:"birth_date"`
	Photos    []int           `json:"photos"`
}

func normalizeSubjectWorks(works []subjectWork) []Book {
	books := make([]Book, 0, len(works))
	for _, work := range works {
		id := NormalizeWorkID(work.Key)
		title := strings.TrimSpace(work.Title)
		if id == "" || title == "" {
			continue
		}
		authors := make([]string, 0, len(work.Authors))
		authorKeys := make([]string, 0, len(work.Authors))
		for _, author := range work.Authors {
			if name := strings.TrimSpace(author.Name); name != "" {
				authors = append(authors, name)
			}
			if key := NormalizeAuthorID(author.Key); key != "" {
				authorKeys = append(authorKeys, key)
			}
		}
		coverID := 0
		if work.CoverID != nil {
			coverID = *work.CoverID
		}
		description := strings.Join(authors, ", ")
		subjects := work.Subject
		if len(subjects) > 8 {
			subjects = subjects[:8]
		}
		books = append(books, Book{
			ID:          id,
			Title:       title,
			Description: description,
			CoverURL:    coverURL(coverID),
			Authors:     authors,
			AuthorKeys:  authorKeys,
			Year:        work.FirstPublishYear,
			Subjects:    subjects,
		})
	}
	return books
}

func normalizeSearchDocs(docs []searchDoc) []Book {
	books := make([]Book, 0, len(docs))
	for _, doc := range docs {
		id := NormalizeWorkID(doc.Key)
		title := strings.TrimSpace(doc.Title)
		if id == "" || title == "" {
			continue
		}
		authors := filterNonEmpty(doc.AuthorName)
		authorKeys := make([]string, 0, len(doc.AuthorKey))
		for _, key := range doc.AuthorKey {
			if id := NormalizeAuthorID(key); id != "" {
				authorKeys = append(authorKeys, id)
			}
		}
		coverID := 0
		if doc.CoverI != nil {
			coverID = *doc.CoverI
		}
		subjects := doc.Subject
		if len(subjects) > 8 {
			subjects = subjects[:8]
		}
		books = append(books, Book{
			ID:          id,
			Title:       title,
			Description: strings.Join(authors, ", "),
			CoverURL:    coverURL(coverID),
			Authors:     authors,
			AuthorKeys:  authorKeys,
			Year:        doc.FirstPublishYear,
			PageCount:   doc.NumberOfPagesMedian,
			Subjects:    subjects,
		})
	}
	return books
}

func pageCountFromSearch(doc *searchDoc) *int {
	if doc == nil {
		return nil
	}
	return doc.NumberOfPagesMedian
}

func NormalizeWorkID(value string) string {
	match := workIDPattern.FindString(value)
	if match == "" {
		return ""
	}
	return strings.ToUpper(match)
}

func NormalizeAuthorID(value string) string {
	match := authorIDPattern.FindString(value)
	if match == "" {
		return ""
	}
	return strings.ToUpper(match)
}

func coverURL(coverID int) string {
	if coverID <= 0 {
		return fallbackCover
	}
	return fmt.Sprintf("%s/b/id/%d-L.jpg", defaultCoversBase, coverID)
}

func authorPhotoURL(authorID string, photoID int) string {
	if photoID > 0 {
		return fmt.Sprintf("%s/a/id/%d-M.jpg", defaultCoversBase, photoID)
	}
	if authorID == "" {
		return fallbackAuthor
	}
	return fmt.Sprintf("%s/a/olid/%s-M.jpg", defaultCoversBase, authorID)
}

func extractText(value openLibraryText) string {
	text := strings.TrimSpace(value.Value)
	if text == "" {
		return ""
	}
	text = regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`).ReplaceAllString(text, "$1")
	text = strings.NewReplacer("*", "", "_", "", "`", "", "#", "").Replace(text)
	return strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
}

func parseYear(value string) *int {
	match := regexp.MustCompile(`(\d{4})`).FindStringSubmatch(value)
	if len(match) < 2 {
		return nil
	}
	year, err := strconv.Atoi(match[1])
	if err != nil {
		return nil
	}
	return &year
}

func yearPtr(value *int) *int {
	return value
}

func searchDocSubjects(doc *searchDoc) []string {
	if doc == nil {
		return nil
	}
	return doc.Subject
}

func filterNonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}
