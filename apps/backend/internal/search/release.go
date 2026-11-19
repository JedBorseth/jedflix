package search

type Release struct {
	Title string
	// Info is a human-readable codec/quality summary ("x264 • 8bit | AAC • 2.0 · WEB-DL").
	Info         string
	Magnet       string
	InfoHash     string
	FileIdx      *int
	SizeBytes    int64
	SizeKnown    bool
	Seeders      int
	SeedersKnown bool
	Quality      string
	Resolution   int
	Source       string
}
