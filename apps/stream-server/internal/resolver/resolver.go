package resolver

import (
	"context"
	"errors"
	"fmt"
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
	MediaTitle      string          `json:"mediaTitle,omitempty"`
	FileIdx         *int            `json:"fileIdx,omitempty"`
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
	FileIdx  *int     `json:"fileIdx,omitempty"`
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
			relaxed := opts
			relaxed.RequireDirectPlaybackCompat = false
			if len(search.FilterReleases(releases, relaxed)) > 0 {
				return nil, fmt.Errorf("no browser-compatible streams found (MKV/Remux/Atmos/DTS filtered)")
			}
		}
		return nil, fmt.Errorf("no streams passed filters")
	}

	// InstantAvailability was permanently disabled by Real Debrid — skip it to avoid
	// wasted API calls that count toward the 250 req/min rate limit.
	ranked := search.ScorePick(filtered, map[string]bool{}, false)
	return toSources(ranked), nil
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

	// Skip FindByInfoHash / ListTorrents — torrents are deleted after each resolve,
	// so a full account torrent listing on every play only burns rate limit budget.
	id, err := rd.AddMagnet(resolveCtx, req.Magnet)
	if err != nil {
		return nil, mapRDError(err)
	}
	torrentID = id
	cleanupTorrent = true

	info, err := rd.GetTorrentInfo(resolveCtx, torrentID)
	if err != nil {
		return nil, mapRDError(err)
	}

	var file realdebrid.TorrentFile
	var ok bool
	if req.Type == "tv" && req.Season != nil && req.Episode != nil {
		file, ok = realdebrid.PickEpisodeFile(info.Files, *req.Season, *req.Episode)
	} else {
		file, ok = realdebrid.PickMovieFile(info.Files, req.MediaTitle, req.FileIdx)
	}
	if !ok {
		return nil, &ResolveError{
			Code:    "title_mismatch",
			Message: "Could not find a matching video file in this torrent. Try another stream.",
		}
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

func mapRDError(err error) error {
	if err == nil {
		return nil
	}
	if realdebrid.IsRateLimitError(err) {
		return &ResolveError{
			Code:    "rate_limited",
			Message: "Real Debrid rate limit reached. Wait a minute before trying another stream.",
		}
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

func toSources(releases []search.Release) []Source {
	sources := make([]Source, 0, len(releases))
	for index, release := range releases {
		source := Source{
			ID:       fmt.Sprintf("src_%d_%s", index, release.InfoHash),
			Title:    release.Title,
			Magnet:   release.Magnet,
			InfoHash: release.InfoHash,
			Cached:   false,
		}
		if release.FileIdx != nil {
			fileIdx := *release.FileIdx
			source.FileIdx = &fileIdx
			source.ID = fmt.Sprintf("src_%d_%s_%d", index, release.InfoHash, fileIdx)
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
