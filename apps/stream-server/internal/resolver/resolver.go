package resolver

import (
	"context"
	"errors"
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

type ResolveRequest struct {
	Type            string          `json:"type"`
	Magnet          string          `json:"magnet"`
	InfoHash        string          `json:"infoHash,omitempty"`
	Title           string          `json:"title,omitempty"`
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

type StreamResult struct {
	URL       string `json:"url"`
	DirectURL string `json:"directUrl,omitempty"`
	Filename  string `json:"filename,omitempty"`
	Filesize  int64  `json:"filesize,omitempty"`
	Mode      string `json:"mode"`
}

type ResolveError struct {
	Code    string
	Message string
}

func (e *ResolveError) Error() string {
	return e.Message
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

func (s *Service) Resolve(ctx context.Context, req ResolveRequest) (*StreamResult, error) {
	token := strings.TrimSpace(req.RealDebridToken)
	if token == "" {
		return nil, &ResolveError{Code: "missing_token", Message: "Real Debrid API key is required for direct streaming."}
	}
	if strings.TrimSpace(req.Magnet) == "" {
		return nil, &ResolveError{Code: "invalid_request", Message: "magnet is required"}
	}
	if search.IsRDBlockedFilename(req.Title, s.cfg.RDBlockedFilenameRegex) {
		return nil, &ResolveError{Code: "infringing_file", Message: "This release matches Real Debrid's infringing-file filter."}
	}

	rd := realdebrid.NewClientWithToken(s.cfg, token)
	maxBytes := int64(s.cfg.MaxVideoSizeGB * 1024 * 1024 * 1024)
	timeout := s.cfg.ResolveTimeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}

	resolveCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	torrentID := ""
	cleanupTorrent := false
	defer func() {
		if cleanupTorrent && torrentID != "" {
			_ = rd.DeleteTorrent(context.Background(), torrentID)
		}
	}()

	if infoHash := strings.TrimSpace(req.InfoHash); infoHash != "" {
		existing, err := rd.FindByInfoHash(resolveCtx, infoHash)
		if err != nil {
			return nil, mapRDError(err)
		}
		if existing != nil {
			switch existing.Status {
			case "downloaded":
				torrentID = existing.ID
				cleanupTorrent = true
			case "error", "magnet_error", "virus", "dead":
				_ = rd.DeleteTorrent(resolveCtx, existing.ID)
			}
		}
	}

	if torrentID == "" {
		id, err := rd.AddMagnet(resolveCtx, req.Magnet)
		if err != nil {
			return nil, mapRDError(err)
		}
		torrentID = id
		cleanupTorrent = true
	}

	info, err := rd.GetTorrentInfo(resolveCtx, torrentID)
	if err != nil {
		return nil, mapRDError(err)
	}

	var file realdebrid.TorrentFile
	var ok bool
	if req.Type == "tv" && req.Season != nil && req.Episode != nil {
		file, ok = realdebrid.PickEpisodeFile(info.Files, *req.Season, *req.Episode)
	} else {
		file, ok = realdebrid.PickLargestVideoFile(info.Files)
	}
	if !ok {
		return nil, &ResolveError{Code: "no_video_file", Message: "No video file found in torrent."}
	}
	if maxBytes > 0 && file.Bytes > maxBytes {
		return nil, &ResolveError{Code: "size_limit", Message: "Selected file exceeds size limit."}
	}

	if err := rd.SelectFiles(resolveCtx, torrentID, []int{file.ID}); err != nil {
		return nil, mapRDError(err)
	}

	info, err = rd.WaitReady(resolveCtx, torrentID, timeout, nil)
	if err != nil {
		if resolveCtx.Err() != nil {
			return nil, &ResolveError{Code: "timeout", Message: "Real Debrid torrent timed out."}
		}
		return nil, mapRDError(err)
	}
	if len(info.Links) == 0 {
		return nil, &ResolveError{Code: "no_links", Message: "Real Debrid returned no links."}
	}

	unrestricted, err := rd.UnrestrictLink(resolveCtx, info.Links[0])
	if err != nil {
		return nil, mapRDError(err)
	}

	return &StreamResult{
		URL:       unrestricted.Download,
		DirectURL: unrestricted.Download,
		Filename:  unrestricted.Filename,
		Filesize:  unrestricted.Filesize,
		Mode:      "direct",
	}, nil
}

func (s *Service) rdClient(req Request) *realdebrid.Client {
	token := strings.TrimSpace(req.RealDebridToken)
	if token == "" {
		return s.rd
	}
	return realdebrid.NewClientWithToken(s.cfg, token)
}

func mapRDError(err error) error {
	if err == nil {
		return nil
	}
	if realdebrid.IsInfringingError(err) {
		return &ResolveError{Code: "infringing_file", Message: err.Error()}
	}
	var resolveErr *ResolveError
	if errors.As(err, &resolveErr) {
		return resolveErr
	}
	msg := err.Error()
	if strings.Contains(strings.ToLower(msg), "timed out") {
		return &ResolveError{Code: "timeout", Message: "Real Debrid torrent timed out."}
	}
	return err
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
