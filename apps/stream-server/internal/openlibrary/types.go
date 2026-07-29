package openlibrary

import "errors"

var (
	ErrNotFound   = errors.New("open library resource not found")
	ErrBadRequest = errors.New("invalid open library request")
	ErrFetchFailed = errors.New("open library fetch failed")
)

type Book struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	CoverURL    string   `json:"coverUrl"`
	Authors     []string `json:"authors"`
	AuthorKeys  []string `json:"authorKeys"`
	Year        *int     `json:"year"`
	PageCount   *int     `json:"pageCount"`
	Subjects    []string `json:"subjects"`
}

type AuthorSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	PhotoURL  string `json:"photoUrl"`
	TopWork   string `json:"topWork,omitempty"`
	WorkCount *int   `json:"workCount,omitempty"`
}

type AuthorDetails struct {
	AuthorSummary
	Biography string `json:"biography"`
	BirthDate string `json:"birthDate,omitempty"`
	Works     []Book `json:"works"`
}

type SubjectRowConfig struct {
	Title   string `json:"title"`
	Subject string `json:"subject"`
}

type SubjectRow struct {
	Title   string `json:"title"`
	Subject string `json:"subject"`
	Books   []Book `json:"books"`
}

type BrowseResponse struct {
	Trending []Book       `json:"trending"`
	Rows     []SubjectRow `json:"rows"`
	CachedAt int64        `json:"cachedAt"`
}

type SearchResponse struct {
	Books   []Book          `json:"books"`
	Authors []AuthorSummary `json:"authors"`
}

var DefaultSubjectRows = []SubjectRowConfig{
	{Title: "NYT Bestsellers", Subject: "new_york_times_bestseller"},
	{Title: "Science Fiction", Subject: "science_fiction"},
	{Title: "Fantasy", Subject: "fantasy"},
	{Title: "Mystery", Subject: "mystery"},
	{Title: "Thrillers", Subject: "thriller"},
	{Title: "Romance", Subject: "romance"},
	{Title: "Horror", Subject: "horror"},
	{Title: "Biography", Subject: "biography"},
	{Title: "History", Subject: "history"},
	{Title: "Young Adult", Subject: "young_adult_fiction"},
}
