package search

import "context"

type Searcher interface {
	SearchMovie(ctx context.Context, imdbID string) ([]Release, error)
	SearchEpisode(ctx context.Context, imdbID string, season, episode int) ([]Release, error)
}
