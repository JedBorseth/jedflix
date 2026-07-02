package resolver

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
	"github.com/jedborseth/jeds-movies/stream-server/internal/proxy"
	"github.com/jedborseth/jeds-movies/stream-server/internal/realdebrid"
	"github.com/jedborseth/jeds-movies/stream-server/internal/search"
)

type Mode string

const (
	ModeDirect Mode = "direct"
	ModeProxy  Mode = "proxy"
)

type Request struct {
	Type     string `json:"type"`
	IMDbID   string `json:"imdbId"`
	Season   *int   `json:"season,omitempty"`
	Episode  *int   `json:"episode,omitempty"`
	Mode     Mode   `json:"mode"`
	Magnet   string `json:"magnet,omitempty"`
	InfoHash string `json:"infoHash,omitempty"`
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
	URL      string `json:"url"`
	DirectURL string `json:"directUrl,omitempty"`
	Filename string `json:"filename,omitempty"`
	Filesize int64  `json:"filesize,omitempty"`
	Mode     Mode   `json:"mode"`
}

type JobStatus string

const (
	StatusSearching   JobStatus = "searching"
	StatusDownloading JobStatus = "downloading"
	StatusReady       JobStatus = "ready"
	StatusFailed      JobStatus = "failed"
)

type Job struct {
	ID        string        `json:"jobId"`
	Status    JobStatus     `json:"status"`
	Progress  string        `json:"progress,omitempty"`
	Error     string        `json:"error,omitempty"`
	Sources   []Source      `json:"sources,omitempty"`
	Stream    *StreamResult `json:"stream,omitempty"`
	CreatedAt time.Time     `json:"createdAt"`
	UpdatedAt time.Time     `json:"updatedAt"`
}

type Service struct {
	cfg        config.Config
	searcher   search.Searcher
	rd         *realdebrid.Client
	signer     *proxy.Signer
	filterOpts search.FilterOptions

	mu   sync.RWMutex
	jobs map[string]*Job
}

func NewService(cfg config.Config, searcher search.Searcher, rd *realdebrid.Client, signer *proxy.Signer) *Service {
	return &Service{
		cfg:        cfg,
		searcher:   searcher,
		rd:         rd,
		signer:     signer,
		filterOpts: search.FilterOptionsFromConfig(cfg),
		jobs:       make(map[string]*Job),
	}
}

func (s *Service) Start(req Request) (*Job, error) {
	if strings.TrimSpace(req.Magnet) == "" && strings.TrimSpace(req.IMDbID) == "" {
		return nil, fmt.Errorf("imdbId is required")
	}
	if req.Mode != ModeDirect && req.Mode != ModeProxy {
		req.Mode = ModeProxy
	}
	if req.Type == "tv" && (req.Season == nil || req.Episode == nil) {
		return nil, fmt.Errorf("season and episode are required for tv")
	}
	if s.cfg.RealDebridToken == "" {
		return nil, fmt.Errorf("REALDEBRID_TOKEN is not configured on the stream server")
	}

	id := fmt.Sprintf("job_%d", time.Now().UnixNano())
	job := &Job{
		ID:        id,
		Status:    StatusSearching,
		Progress:  "Searching for streams",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	s.save(job)

	go s.run(id, req)
	return cloneJob(job), nil
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
	filtered := search.FilterReleases(releases, s.filterOpts)
	if len(filtered) == 0 {
		return nil, fmt.Errorf("no streams passed filters")
	}

	hashes := make([]string, 0, len(filtered))
	for _, release := range filtered {
		if release.InfoHash != "" {
			hashes = append(hashes, release.InfoHash)
		}
	}
	instant, _ := s.rd.InstantAvailability(ctx, hashes)
	ranked := search.ScorePick(filtered, instant, s.cfg.PreferInstant)
	return toSources(ranked, instant), nil
}

func (s *Service) Get(jobID string) (*Job, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.jobs[jobID]
	if !ok {
		return nil, false
	}
	return cloneJob(job), true
}

func (s *Service) save(job *Job) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job.UpdatedAt = time.Now()
	s.jobs[job.ID] = job
}

func (s *Service) run(jobID string, req Request) {
	ctx, cancel := context.WithTimeout(context.Background(), s.cfg.ResolveTimeout)
	defer cancel()

	maxBytes := int64(s.cfg.MaxVideoSizeGB * 1024 * 1024 * 1024)

	if magnet := strings.TrimSpace(req.Magnet); magnet != "" {
		s.update(jobID, StatusDownloading, "Resolving selected stream", nil, nil, "")
		release := search.Release{Magnet: magnet, InfoHash: strings.ToLower(strings.TrimSpace(req.InfoHash))}
		stream, err := s.tryRelease(ctx, req, release, maxBytes, req.Mode)
		if err != nil {
			s.update(jobID, StatusFailed, "", nil, nil, err.Error())
			return
		}
		s.update(jobID, StatusReady, "Stream ready", nil, stream, "")
		return
	}

	s.update(jobID, StatusSearching, "Searching Torrentio", nil, nil, "")

	releases, err := s.search(ctx, req)
	if err != nil {
		s.update(jobID, StatusFailed, "", nil, nil, err.Error())
		return
	}
	if len(releases) == 0 {
		s.update(jobID, StatusFailed, "", nil, nil, "no streams found")
		return
	}

	filtered := search.FilterReleases(releases, s.filterOpts)
	if len(filtered) == 0 {
		s.update(jobID, StatusFailed, "", toSources(releases, nil), nil, "no streams passed filters")
		return
	}

	hashes := make([]string, 0, len(filtered))
	for _, release := range filtered {
		if release.InfoHash != "" {
			hashes = append(hashes, release.InfoHash)
		}
	}
	instant, _ := s.rd.InstantAvailability(ctx, hashes)
	ranked := search.ScorePick(filtered, instant, s.cfg.PreferInstant)
	s.update(jobID, StatusSearching, "Found candidate streams", toSources(ranked, instant), nil, "")

	var lastErr error
	for i, release := range ranked {
		s.update(jobID, StatusDownloading, fmt.Sprintf("Trying stream %d/%d", i+1, len(ranked)), toSources(ranked, instant), nil, "")
		stream, err := s.tryRelease(ctx, req, release, maxBytes, req.Mode)
		if err != nil {
			lastErr = err
			continue
		}
		s.update(jobID, StatusReady, "Stream ready", toSources(ranked, instant), stream, "")
		return
	}

	errMsg := "all candidate streams failed"
	if lastErr != nil {
		errMsg = lastErr.Error()
	}
	s.update(jobID, StatusFailed, "", toSources(ranked, instant), nil, errMsg)
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

func (s *Service) tryRelease(ctx context.Context, req Request, release search.Release, maxBytes int64, mode Mode) (*StreamResult, error) {
	torrentID, err := s.rd.AddMagnet(ctx, release.Magnet)
	if err != nil {
		return nil, err
	}

	info, err := s.rd.GetTorrentInfo(ctx, torrentID)
	if err != nil {
		return nil, err
	}

	var file realdebrid.TorrentFile
	var ok bool
	if req.Type == "tv" {
		file, ok = realdebrid.PickEpisodeFile(info.Files, *req.Season, *req.Episode)
	} else {
		file, ok = realdebrid.PickLargestVideoFile(info.Files)
	}
	if !ok {
		return nil, fmt.Errorf("no video file found in torrent")
	}
	if file.Bytes > maxBytes {
		return nil, fmt.Errorf("selected file exceeds size limit")
	}

	if err := s.rd.SelectFiles(ctx, torrentID, []int{file.ID}); err != nil {
		return nil, err
	}

	info, err = s.rd.WaitReady(ctx, torrentID, s.cfg.ResolveTimeout)
	if err != nil {
		return nil, err
	}
	if len(info.Links) == 0 {
		return nil, fmt.Errorf("real-debrid returned no links")
	}

	unrestricted, err := s.rd.UnrestrictLink(ctx, info.Links[0])
	if err != nil {
		return nil, err
	}

	result := &StreamResult{
		DirectURL: unrestricted.Download,
		Filename:  unrestricted.Filename,
		Filesize:  unrestricted.Filesize,
		Mode:      mode,
		URL:       unrestricted.Download,
	}

	if mode == ModeProxy {
		token, err := s.signer.Sign(unrestricted.Download, unrestricted.Filename, 6*time.Hour)
		if err != nil {
			return nil, err
		}
		result.URL = "/api/v1/proxy/" + token
	}

	return result, nil
}

func (s *Service) update(jobID string, status JobStatus, progress string, sources []Source, stream *StreamResult, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[jobID]
	if !ok {
		return
	}
	job.Status = status
	job.Progress = progress
	if sources != nil {
		job.Sources = sources
	}
	if stream != nil {
		job.Stream = stream
	}
	job.Error = errMsg
	job.UpdatedAt = time.Now()
}

func cloneJob(job *Job) *Job {
	copy := *job
	if job.Stream != nil {
		streamCopy := *job.Stream
		copy.Stream = &streamCopy
	}
	if job.Sources != nil {
		copy.Sources = append([]Source(nil), job.Sources...)
	}
	return &copy
}

func toSources(releases []search.Release, instant map[string]bool) []Source {
	out := make([]Source, 0, len(releases))
	for _, release := range releases {
		id := release.InfoHash
		if id == "" {
			id = release.Magnet
		}
		source := Source{
			ID:       id,
			Title:    release.Title,
			Magnet:   release.Magnet,
			InfoHash: release.InfoHash,
			Cached:   instant != nil && release.InfoHash != "" && instant[strings.ToLower(release.InfoHash)],
		}
		if release.SizeKnown {
			gb := float64(release.SizeBytes) / (1024 * 1024 * 1024)
			source.SizeGB = &gb
		}
		if release.SeedersKnown {
			seeders := release.Seeders
			source.Seeders = &seeders
		}
		out = append(out, source)
	}
	return out
}
