// Package musiccatalog defines provider-agnostic music catalog types
// shared by MusicBrainz (browse/search) and Last.fm (recommendations).
package musiccatalog

import "errors"

var (
	ErrNotFound      = errors.New("music catalog resource not found")
	ErrBadRequest    = errors.New("invalid music catalog request")
	ErrFetchFailed   = errors.New("music catalog fetch failed")
	ErrNotConfigured = errors.New("music catalog is not configured")
	ErrRateLimited   = errors.New("music catalog rate limited")
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
	Albums  []Album      `json:"albums"`
	Artists []Artist     `json:"artists"`
	Tracks  []TopTrack   `json:"tracks"`
	Ranked  []RankedHit  `json:"ranked,omitempty"`
}

type RankedHit struct {
	Kind  string  `json:"kind"`
	ID    string  `json:"id"`
	Score float64 `json:"score"`
}

// GenreConfig defines a curated genre shelf.
type GenreConfig struct {
	Key         string
	Title       string
	SearchQuery string
	Seeds       []string
}

// DefaultGenres drive the music home catalog.
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

type AlbumHints struct {
	Name    string
	Artists []string
}

type ArtistHints struct {
	Name string
}
