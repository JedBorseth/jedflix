package letterboxd

import "errors"

var (
	ErrInvalidUsername = errors.New("invalid letterboxd username")
	ErrNotFound        = errors.New("letterboxd profile not found")
	ErrNoFilms         = errors.New("letterboxd profile has no diary films")
	ErrFetchFailed     = errors.New("failed to fetch letterboxd data")
)

// FilmEntry is a diary film ordered by watched date (newest first).
type FilmEntry struct {
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Year        *int     `json:"year,omitempty"`
	PosterURL   string   `json:"posterUrl,omitempty"`
	WatchedDate string   `json:"watchedDate,omitempty"`
	TmdbID      *int     `json:"tmdbId,omitempty"`
	Rating      *float64 `json:"rating,omitempty"`
	Link        string   `json:"link,omitempty"`
}

// FilmsResponse is returned by the films-by-date API.
type FilmsResponse struct {
	User        string      `json:"user"`
	DisplayName string      `json:"displayName,omitempty"`
	Films       []FilmEntry `json:"films"`
	CachedAt    int64       `json:"cachedAt"`
	Source      string      `json:"source"`
}

// VerifyResponse is returned when validating a Letterboxd username.
type VerifyResponse struct {
	Valid       bool        `json:"valid"`
	Username    string      `json:"username"`
	DisplayName string      `json:"displayName,omitempty"`
	FilmCount   int         `json:"filmCount"`
	Films       []FilmEntry `json:"films,omitempty"`
	CachedAt    int64       `json:"cachedAt"`
	Error       string      `json:"error,omitempty"`
}

type cacheEntry struct {
	Username    string
	DisplayName string
	Films       []FilmEntry
	CachedAt    int64
}
