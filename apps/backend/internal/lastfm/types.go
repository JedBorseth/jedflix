package lastfm

import "errors"

var (
	ErrNotConfigured = errors.New("last.fm api key is not configured")
	ErrBadRequest    = errors.New("invalid last.fm request")
	ErrNotFound      = errors.New("last.fm resource not found")
	ErrFetchFailed   = errors.New("last.fm fetch failed")
)

// SimilarArtist is a raw Last.fm similar-artist hit before Spotify resolution.
type SimilarArtist struct {
	Name     string  `json:"name"`
	MBID     string  `json:"mbid,omitempty"`
	URL      string  `json:"url,omitempty"`
	Match    float64 `json:"match,omitempty"`
	ImageURL string  `json:"imageUrl,omitempty"`
}

// SimilarTrack is a raw Last.fm similar-track hit before Spotify resolution.
type SimilarTrack struct {
	Name     string  `json:"name"`
	Artist   string  `json:"artist"`
	MBID     string  `json:"mbid,omitempty"`
	URL      string  `json:"url,omitempty"`
	Match    float64 `json:"match,omitempty"`
	ImageURL string  `json:"imageUrl,omitempty"`
}

// Tag is a Last.fm genre/tag.
type Tag struct {
	Name  string `json:"name"`
	Count int    `json:"count,omitempty"`
}
