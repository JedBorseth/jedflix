package resolver

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
	"github.com/jedborseth/jeds-movies/stream-server/internal/realdebrid"
	"github.com/jedborseth/jeds-movies/stream-server/internal/search"
)

type PlaybackProfile string

const (
	PlaybackBrowser  PlaybackProfile = "browser"
	PlaybackExternal PlaybackProfile = "external"
)

type Request struct {
	Type            string          `json:"type"`
	IMDbID          string          `json:"imdbId"`
	Season          *int            `json:"season,omitempty"`
	Episode         *int            `json:"episode,omitempty"`
	PlaybackProfile PlaybackProfile `json:"playbackProfile,omitempty"`
	RealDebridToken string          `json:"realDebridToken,omitempty"`
}

type Source struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Magnet   string   `json:"magnet"`
	InfoHash string   `json:"infoHash,omitempty"`
	SizeGB   *float64 `json:"sizeGb,omitempty"`
	Seeders  *int     `json:"seeders,omitempty"`
	Cached   bool     `json:"cached"`
}

type Service struct {
	cfg        config.Config
	searcher   search.Searcher
	rd         *realdebrid.Client
	filterOpts search.FilterOptions
}

func NewService(cfg config.Config, searcher search.Searcher, rd *realdebrid.Client) *Service {
	return &Service{
		cfg:        cfg,
		searcher:   searcher,
		rd:         rd,
		filterOpts: search.FilterOptionsFromConfig(cfg),
	}
}

func (s *Service) ListSources(req Request) ([]Source, error) {
	if strings.TrimSpace(req.IMDbID) == "" {
		return nil, fmt.Errorf("imdbId is required")
	}
	if req.Type == "tv" && (req.Season == nil || req.Episode == nil) {
		return nil, fmt.Errorf("season and episode are required for tv")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	releases, err := s.search(ctx, req)
	if err != nil {
		return nil, err
	}

	opts := s.filterOpts
	opts.RequireDirectPlaybackCompat = req.PlaybackProfile != PlaybackExternal
	filtered := search.FilterReleases(releases, opts)
	if len(filtered) == 0 {
		if opts.RequireDirectPlaybackCompat {
			return nil, fmt.Errorf("no browser-compatible streams found (MKV/Remux/Atmos/DTS filtered)")
		}
		return nil, fmt.Errorf("no streams passed filters")
	}

	hashes := make([]string, 0, len(filtered))
	for _, release := range filtered {
		if release.InfoHash != "" {
			hashes = append(hashes, release.InfoHash)
		}
	}
	rd := s.rdClient(req)
	instant, err := rd.InstantAvailability(ctx, hashes)
	if err != nil {
		log.Printf("warning: real-debrid instantAvailability failed: %v", err)
		instant = map[string]bool{}
	}
	ranked := search.ScorePick(filtered, instant, s.cfg.PreferInstant)
	return toSources(ranked, instant), nil
}

func (s *Service) search(ctx context.Context, req Request) ([]search.Release, error) {
	switch req.Type {
	case "movie":
		return s.searcher.SearchMovie(ctx, req.IMDbID)
	case "tv":
		return s.searcher.SearchEpisode(ctx, req.IMDbID, *req.Season, *req.Episode)
	default:
		return nil, fmt.Errorf("unsupported type %q", req.Type)
	}
}

func (s *Service) rdClient(req Request) *realdebrid.Client {
	token := strings.TrimSpace(req.RealDebridToken)
	if token == "" {
		return s.rd
	}
	return realdebrid.NewClientWithToken(s.cfg, token)
}

func toSources(releases []search.Release, instant map[string]bool) []Source {
	sources := make([]Source, 0, len(releases))
	for index, release := range releases {
		source := Source{
			ID:       fmt.Sprintf("src_%d_%s", index, release.InfoHash),
			Title:    release.Title,
			Magnet:   release.Magnet,
			InfoHash: release.InfoHash,
			Cached:   release.InfoHash != "" && instant[strings.ToLower(release.InfoHash)],
		}
		if release.SizeKnown {
			sizeGB := float64(release.SizeBytes) / (1024 * 1024 * 1024)
			source.SizeGB = &sizeGB
		}
		if release.SeedersKnown {
			seeders := release.Seeders
			source.Seeders = &seeders
		}
		sources = append(sources, source)
	}
	return sources
}
