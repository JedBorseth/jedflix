package spotify

import "errors"

var (
	ErrNotFound      = errors.New("spotify resource not found")
	ErrBadRequest    = errors.New("invalid spotify request")
	ErrFetchFailed   = errors.New("spotify fetch failed")
	ErrNotConfigured = errors.New("spotify client credentials are not configured")
)

type Album struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Artists     []string `json:"artists"`
	ArtistIDs   []string `json:"artistIds"`
	ImageURL    string   `json:"imageUrl"`
	ReleaseDate string   `json:"releaseDate,omitempty"`
	Year        *int     `json:"year"`
	AlbumType   string   `json:"albumType,omitempty"`
	TotalTracks int      `json:"totalTracks,omitempty"`
	Label       string   `json:"label,omitempty"`
	Genres      []string `json:"genres"`
	Popularity  int      `json:"popularity,omitempty"`
}

type Artist struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	ImageURL   string   `json:"imageUrl"`
	Genres     []string `json:"genres"`
	Followers  int      `json:"followers,omitempty"`
	Popularity int      `json:"popularity,omitempty"`
}

type ArtistDetails struct {
	Artist
	Albums []Album `json:"albums"`
}

type CatalogRow struct {
	Title   string   `json:"title"`
	Key     string   `json:"key"`
	Kind    string   `json:"kind"` // "albums" | "artists"
	Albums  []Album  `json:"albums,omitempty"`
	Artists []Artist `json:"artists,omitempty"`
}

type BrowseResponse struct {
	NewReleases []Album      `json:"newReleases"`
	Rows        []CatalogRow `json:"rows"`
	CachedAt    int64        `json:"cachedAt"`
}

type SearchResponse struct {
	Albums  []Album  `json:"albums"`
	Artists []Artist `json:"artists"`
}

type RowConfig struct {
	Title string
	Key   string
	Kind  string // "albums" | "artists"
	Query string
}

var DefaultCatalogRows = []RowConfig{
	{Title: "Pop", Key: "pop-albums", Kind: "albums", Query: `genre:"pop"`},
	{Title: "Popular Artists", Key: "popular-artists", Kind: "artists", Query: `genre:"pop"`},
	{Title: "Hip-Hop", Key: "hiphop-albums", Kind: "albums", Query: `genre:"hip-hop"`},
	{Title: "Hip-Hop Artists", Key: "hiphop-artists", Kind: "artists", Query: `genre:"hip-hop"`},
	{Title: "Rock", Key: "rock-albums", Kind: "albums", Query: `genre:"rock"`},
	{Title: "Rock Artists", Key: "rock-artists", Kind: "artists", Query: `genre:"rock"`},
	{Title: "Electronic", Key: "electronic-albums", Kind: "albums", Query: `genre:"electronic"`},
	{Title: "R&B Artists", Key: "rnb-artists", Kind: "artists", Query: `genre:"r&b"`},
	{Title: "Indie", Key: "indie-albums", Kind: "albums", Query: `genre:"indie"`},
	{Title: "Jazz Artists", Key: "jazz-artists", Kind: "artists", Query: `genre:"jazz"`},
}
