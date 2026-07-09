package search

type Release struct {
	Title       string
	Magnet      string
	InfoHash    string
	SizeBytes   int64
	SizeKnown   bool
	Seeders     int
	SeedersKnown bool
	Quality     string
	Resolution  int
	Source      string
}
