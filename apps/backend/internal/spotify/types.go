package spotify

import "errors"

var (
	ErrNotFound      = errors.New("spotify resource not found")
	ErrBadRequest    = errors.New("invalid spotify request")
	ErrFetchFailed   = errors.New("spotify fetch failed")
	ErrNotConfigured = errors.New("spotify client credentials are not configured")
	ErrRateLimited   = errors.New("spotify rate limited")
)

type Track struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Artists     []string `json:"artists"`
	ArtistIDs   []string `json:"artistIds"`
	TrackNumber int      `json:"trackNumber"`
	DiscNumber  int      `json:"discNumber"`
	DurationMs  int      `json:"durationMs"`
	Explicit    bool     `json:"explicit"`
}

// TopTrack is a popular track with enough album context for playback.
type TopTrack struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Artists     []string `json:"artists"`
	ArtistIDs   []string `json:"artistIds"`
	TrackNumber int      `json:"trackNumber"`
	DiscNumber  int      `json:"discNumber"`
	DurationMs  int      `json:"durationMs"`
	Explicit    bool     `json:"explicit"`
	AlbumID     string   `json:"albumId"`
	AlbumName   string   `json:"albumName"`
	ImageURL    string   `json:"imageUrl"`
}

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
	Tracks      []Track  `json:"tracks,omitempty"`
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
	TopTracks   []TopTrack `json:"topTracks"`
	Albums      []Album    `json:"albums"`
	Discography []Album    `json:"discography"`
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
	Albums  []Album    `json:"albums"`
	Artists []Artist   `json:"artists"`
	Tracks  []TopTrack `json:"tracks"`
}

// GenreConfig defines a curated genre shelf.
// SearchQuery (or Title) drives lean Dev Mode catalog refresh via Spotify search.
// Seeds remain available for richer expansion helpers/tests.
type GenreConfig struct {
	Key         string   // stable slug used in row keys, e.g. "pop"
	Title       string   // display title, e.g. "Pop"
	SearchQuery string   // Spotify search query; defaults to Title
	Seeds       []string // optional seed artist names (legacy expansion helpers)
}

// DefaultGenres drive the music home catalog. Each genre expands into
// Popular Artists, Popular Albums, and Popular Singles rows via search.
var DefaultGenres = []GenreConfig{
	{
		Key: "pop", Title: "Pop", SearchQuery: "pop",
		Seeds: []string{
			"Taylor Swift", "Dua Lipa", "Olivia Rodrigo", "Billie Eilish", "Ariana Grande",
			"Harry Styles", "Sabrina Carpenter", "Doja Cat", "Charlie Puth", "Shawn Mendes",
		},
	},
	{
		Key: "rock", Title: "Rock", SearchQuery: "rock",
		Seeds: []string{
			"Foo Fighters", "Linkin Park", "Green Day", "Muse", "Arctic Monkeys",
			"Imagine Dragons", "Red Hot Chili Peppers", "The Killers", "Nirvana", "Radiohead",
		},
	},
	{
		Key: "hipHop", Title: "Hip-Hop", SearchQuery: "hip hop",
		Seeds: []string{
			"Drake", "Kendrick Lamar", "Travis Scott", "J. Cole", "Future",
			"Lil Baby", "Megan Thee Stallion", "Cardi B", "Lil Uzi Vert", "Playboi Carti",
		},
	},
	{
		Key: "rap", Title: "Rap", SearchQuery: "rap",
		Seeds: []string{
			"Kanye West", "Nicki Minaj", "21 Savage", "Metro Boomin", "Eminem",
			"Jay-Z", "Lil Wayne", "Nas", "Ice Spice", "Jack Harlow",
		},
	},
	{
		Key: "electronic", Title: "Electronic", SearchQuery: "electronic",
		Seeds: []string{
			"David Guetta", "Calvin Harris", "Fred again..", "The Chainsmokers", "Skrillex",
			"Marshmello", "Martin Garrix", "Tiësto", "Disclosure", "Flume",
		},
	},
	{
		Key: "country", Title: "Country", SearchQuery: "country",
		Seeds: []string{
			"Morgan Wallen", "Luke Combs", "Chris Stapleton", "Zach Bryan", "Kacey Musgraves",
			"Luke Bryan", "Carrie Underwood", "Kane Brown", "Thomas Rhett", "Lainey Wilson",
		},
	},
	{
		Key: "rnb", Title: "R&B", SearchQuery: "r&b",
		Seeds: []string{
			"The Weeknd", "SZA", "Frank Ocean", "Bruno Mars", "H.E.R.",
			"Summer Walker", "Jhené Aiko", "Brent Faiyaz", "Giveon", "Daniel Caesar",
		},
	},
}

// RowConfig is retained for playlist/search fallback helpers and tests.
type RowConfig struct {
	Title      string
	Key        string
	Kind       string // "albums" | "artists"
	Query      string
	PlaylistID string // when set, populate from a public Spotify playlist (albums or artists by Kind)
}
