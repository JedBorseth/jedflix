package spotify

import "errors"

var (
	ErrNotFound      = errors.New("spotify resource not found")
	ErrBadRequest    = errors.New("invalid spotify request")
	ErrFetchFailed   = errors.New("spotify fetch failed")
	ErrNotConfigured = errors.New("spotify client credentials are not configured")
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
	Albums  []Album  `json:"albums"`
	Artists []Artist `json:"artists"`
}

type RowConfig struct {
	Title      string
	Key        string
	Kind       string // "albums" | "artists"
	Query      string
	PlaylistID string // when set, populate from a public Spotify playlist (albums or artists by Kind)
}

// Rows are populated from official Spotify editorial playlists so shelves
// reflect curated catalogs instead of keyword search noise.
// New Releases is last so featured genre shelves show first.
var DefaultCatalogRows = []RowConfig{
	// Today's Top Hits
	{Title: "Pop", Key: "pop-albums", Kind: "albums", PlaylistID: "37i9dQZF1DXcBWIGoYBM5M"},
	{Title: "Popular Artists", Key: "popular-artists", Kind: "artists", PlaylistID: "37i9dQZF1DXcBWIGoYBM5M"},
	// RapCaviar
	{Title: "Hip-Hop", Key: "hiphop-playlist", Kind: "albums", PlaylistID: "37i9dQZF1DX0XUsuxWHRQd"},
	{Title: "Hip-Hop Artists", Key: "hiphop-artists", Kind: "artists", PlaylistID: "37i9dQZF1DX0XUsuxWHRQd"},
	// Rock Classics
	{Title: "Rock", Key: "rock-albums", Kind: "albums", PlaylistID: "37i9dQZF1DWXRqgorJj26U"},
	{Title: "Rock Artists", Key: "rock-artists", Kind: "artists", PlaylistID: "37i9dQZF1DWXRqgorJj26U"},
	// mint
	{Title: "Electronic", Key: "electronic-albums", Kind: "albums", PlaylistID: "37i9dQZF1DX4dyzvuaRJ0n"},
	// Chilled R&B
	{Title: "R&B Artists", Key: "rnb-artists", Kind: "artists", PlaylistID: "37i9dQZF1DX2UgsUIg75Vg"},
	// Indie Pop
	{Title: "Indie", Key: "indie-albums", Kind: "albums", PlaylistID: "37i9dQZF1DWWEcRhUVtL8n"},
	// Jazz Classics
	{Title: "Jazz Artists", Key: "jazz-artists", Kind: "artists", PlaylistID: "37i9dQZF1DXbITWG1ZJKYt"},
	// New Music Friday
	{Title: "New Releases", Key: "new-releases", Kind: "albums", PlaylistID: "37i9dQZF1DX4JAvHpjipBk"},
}
