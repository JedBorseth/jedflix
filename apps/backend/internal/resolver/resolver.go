package resolver

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/abb"
	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/realdebrid"
	"github.com/jedborseth/jeds-movies/backend/internal/search"
)

type PlaybackProfile string

const (
	PlaybackBrowser  PlaybackProfile = "browser"
	PlaybackExternal PlaybackProfile = "external"
)

type Request struct {
	Type            string          `json:"type"`
	IMDbID          string          `json:"imdbId,omitempty"`
	Season          *int            `json:"season,omitempty"`
	Episode         *int            `json:"episode,omitempty"`
	Query           string          `json:"query,omitempty"`
	Title           string          `json:"title,omitempty"`
	Author          string          `json:"author,omitempty"`
	PlaybackProfile PlaybackProfile `json:"playbackProfile,omitempty"`
	RealDebridToken string          `json:"realDebridToken,omitempty"`
}

type ResolveRequest struct {
	Type            string          `json:"type"`
	Magnet          string          `json:"magnet"`
	AbbPostURL      string          `json:"abbPostUrl,omitempty"`
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
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Magnet     string   `json:"magnet"`
	InfoHash   string   `json:"infoHash,omitempty"`
	FileIdx    *int     `json:"fileIdx,omitempty"`
	SizeGB     *float64 `json:"sizeGb,omitempty"`
	Seeders    *int     `json:"seeders,omitempty"`
	Cached     bool     `json:"cached"`
	AbbPostURL string   `json:"abbPostUrl,omitempty"`
	Info       string   `json:"info,omitempty"`
	MatchScore *float64 `json:"matchScore,omitempty"`
}

type StreamFile struct {
	Index    int    `json:"index"`
	FileID   int    `json:"fileId"`
	Filename string `json:"filename"`
	URL      string `json:"url"`
	Filesize int64  `json:"filesize"`
	MimeType string `json:"mimeType,omitempty"`
}

type StreamResult struct {
	URL       string       `json:"url"`
	DirectURL string       `json:"directUrl,omitempty"`
	Filename  string       `json:"filename,omitempty"`
	Filesize  int64        `json:"filesize,omitempty"`
	Mode      string       `json:"mode"`
	Files     []StreamFile `json:"files,omitempty"`
	PackKind  string       `json:"packKind,omitempty"`
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
	abb        *abb.Client
	filterOpts search.FilterOptions
}

func NewService(cfg config.Config, searcher search.Searcher, rd *realdebrid.Client, abbClient *abb.Client) *Service {
	return &Service{
		cfg:        cfg,
		searcher:   searcher,
		rd:         rd,
		abb:        abbClient,
		filterOpts: search.FilterOptionsFromConfig(cfg),
	}
}

func (s *Service) ListSources(req Request) ([]Source, error) {
	switch req.Type {
	case "audiobook", "ebook":
		return s.listBookSources(req)
	case "movie", "tv", "":
		return s.listVideoSources(req)
	default:
		return nil, fmt.Errorf("unsupported type %q", req.Type)
	}
}

func (s *Service) listVideoSources(req Request) ([]Source, error) {
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

func (s *Service) listBookSources(req Request) ([]Source, error) {
	if s.abb == nil {
		return nil, fmt.Errorf("audiobook discovery is not configured")
	}
	title := strings.TrimSpace(req.Title)
	author := strings.TrimSpace(req.Author)
	query := strings.TrimSpace(req.Query)
	if query == "" {
		query = strings.TrimSpace(title + " " + author)
	}
	if query == "" {
		return nil, fmt.Errorf("query or title is required for %s", req.Type)
	}

	ranked, err := s.searchAndRankBooks(query, title, author)
	if err != nil {
		return nil, err
	}
	// Prefer a title-only search when the combined query produced nothing useful.
	if len(ranked) == 0 && title != "" && !strings.EqualFold(strings.TrimSpace(query), title) {
		ranked, err = s.searchAndRankBooks(title, title, author)
		if err != nil {
			return nil, err
		}
	}
	if len(ranked) == 0 {
		return nil, fmt.Errorf("no AudiobookBay matches found")
	}

	sources := make([]Source, 0, len(ranked))
	for index, result := range ranked {
		score := result.Score
		sources = append(sources, Source{
			ID:         fmt.Sprintf("abb_%d", index),
			Title:      result.Title,
			Magnet:     "",
			AbbPostURL: result.URL,
			Info:       result.Info,
			MatchScore: &score,
			Cached:     false,
		})
	}

	// Prefetch magnets for the top hits so resolve can hit Real Debrid immediately.
	s.enrichBookMagnets(sources, 5)
	// Audiobook picker shows RD seeder counts (red when < 3 on the web client).
	if req.Type == "audiobook" && strings.TrimSpace(req.RealDebridToken) != "" {
		s.enrichBookSeedersFromRD(sources, 3, req.RealDebridToken)
	}
	return sources, nil
}

func (s *Service) enrichBookMagnets(sources []Source, limit int) {
	if s.abb == nil || limit <= 0 {
		return
	}
	if limit > len(sources) {
		limit = len(sources)
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, 3)
	for i := 0; i < limit; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			post, err := s.abb.GetPost(sources[index].AbbPostURL)
			if err != nil || post == nil || strings.TrimSpace(post.Magnet) == "" {
				return
			}
			sources[index].Magnet = post.Magnet
			if hash := infoHashFromMagnet(post.Magnet); hash != "" {
				sources[index].InfoHash = hash
			}
		}(i)
	}
	wg.Wait()
}

// enrichBookSeedersFromRD briefly adds magnets to Real Debrid to read swarm
// seeders for the audiobook stream picker, then deletes the torrents.
func (s *Service) enrichBookSeedersFromRD(sources []Source, limit int, token string) {
	token = strings.TrimSpace(token)
	if token == "" || limit <= 0 {
		return
	}
	if limit > len(sources) {
		limit = len(sources)
	}

	rd := realdebrid.NewClientWithToken(s.cfg, token)
	var wg sync.WaitGroup
	sem := make(chan struct{}, 2)
	for i := 0; i < limit; i++ {
		magnet := strings.TrimSpace(sources[i].Magnet)
		if magnet == "" {
			continue
		}
		wg.Add(1)
		go func(index int, magnetURL string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			seeders, ok := probeRDSeeders(rd, magnetURL)
			if !ok {
				return
			}
			sources[index].Seeders = &seeders
		}(i, magnet)
	}
	wg.Wait()
}

func probeRDSeeders(rd *realdebrid.Client, magnet string) (int, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	torrentID, err := rd.AddMagnet(ctx, magnet)
	if err != nil || torrentID == "" {
		return 0, false
	}
	defer func() {
		deleteCtx, deleteCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer deleteCancel()
		_ = rd.DeleteTorrent(deleteCtx, torrentID)
	}()

	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return 0, false
		}
		info, infoErr := rd.GetTorrentInfo(ctx, torrentID)
		if infoErr != nil || info == nil {
			return 0, false
		}
		if info.Seeders != nil {
			return *info.Seeders, true
		}
		switch info.Status {
		case "error", "magnet_error", "virus", "dead":
			return 0, false
		case "waiting_files_selection", "downloaded", "queued":
			// Seeders are only exposed during magnet_conversion / downloading.
			return 0, false
		}
		select {
		case <-ctx.Done():
			return 0, false
		case <-time.After(350 * time.Millisecond):
		}
	}
	return 0, false
}

func infoHashFromMagnet(magnet string) string {
	lower := strings.ToLower(magnet)
	const prefix = "urn:btih:"
	idx := strings.Index(lower, prefix)
	if idx < 0 {
		return ""
	}
	rest := magnet[idx+len(prefix):]
	end := 0
	for end < len(rest) {
		c := rest[end]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') {
			end++
			continue
		}
		break
	}
	if end < 32 {
		return ""
	}
	return strings.ToLower(rest[:end])
}

func (s *Service) searchAndRankBooks(query, title, author string) ([]abb.RankedResult, error) {
	results, err := s.abb.Search(query)
	if err != nil {
		return nil, err
	}
	return abb.RankResults(results, title, author, 25), nil
}

func (s *Service) search(ctx context.Context, req Request) ([]search.Release, error) {
	switch req.Type {
	case "movie", "":
		return s.searcher.SearchMovie(ctx, req.IMDbID)
	case "tv":
		return s.searcher.SearchEpisode(ctx, req.IMDbID, *req.Season, *req.Episode)
	default:
		return nil, fmt.Errorf("unsupported type %q", req.Type)
	}
}

func (s *Service) Resolve(ctx context.Context, req ResolveRequest) (*StreamResult, error) {
	return s.ResolveWithProgress(ctx, req, nil)
}

func (s *Service) ResolveWithProgress(
	ctx context.Context,
	req ResolveRequest,
	onProgress func(string),
) (*StreamResult, error) {
	report := func(message string) {
		if onProgress != nil && strings.TrimSpace(message) != "" {
			onProgress(message)
		}
	}

	token := strings.TrimSpace(req.RealDebridToken)
	if token == "" {
		return nil, &ResolveError{Code: "missing_token", Message: "Real Debrid API key is required for direct streaming."}
	}

	magnet := strings.TrimSpace(req.Magnet)
	if magnet == "" && strings.TrimSpace(req.InfoHash) != "" {
		magnet = "magnet:?xt=urn:btih:" + strings.ToLower(strings.TrimSpace(req.InfoHash))
	}
	if magnet == "" && strings.TrimSpace(req.AbbPostURL) != "" {
		if s.abb == nil {
			return nil, &ResolveError{Code: "invalid_request", Message: "audiobook discovery is not configured"}
		}
		report("Fetching magnet from AudiobookBay…")
		post, err := s.abb.GetPost(strings.TrimSpace(req.AbbPostURL))
		if err != nil {
			return nil, &ResolveError{
				Code:    "abb_magnet",
				Message: "Could not fetch magnet from AudiobookBay: " + err.Error(),
			}
		}
		magnet = post.Magnet
		if strings.TrimSpace(req.Title) == "" {
			req.Title = post.Title
		}
	}
	if magnet == "" {
		return nil, &ResolveError{Code: "invalid_request", Message: "magnet or abbPostUrl is required"}
	}
	if search.IsRDBlockedFilename(req.Title, s.cfg.RDBlockedFilenameRegex) {
		return nil, &ResolveError{Code: "infringing_file", Message: "This release matches Real Debrid's infringing-file filter."}
	}

	if req.Type == "audiobook" || req.Type == "ebook" {
		return s.resolveBook(ctx, token, magnet, req, report)
	}
	return s.resolveVideo(ctx, token, magnet, req, report)
}

func (s *Service) resolveVideo(
	ctx context.Context,
	token, magnet string,
	req ResolveRequest,
	report func(string),
) (*StreamResult, error) {
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

	report("Adding magnet to Real Debrid…")
	id, err := rd.AddMagnet(resolveCtx, magnet)
	if err != nil {
		return nil, mapRDError(err)
	}
	torrentID = id
	cleanupTorrent = true
	report("Magnet added to Real Debrid. Waiting for file list…")

	info, err := rd.WaitForFileList(resolveCtx, torrentID, timeout)
	if err != nil {
		if resolveCtx.Err() != nil {
			return nil, &ResolveError{Code: "timeout", Message: "Real Debrid timed out while fetching torrent metadata. Try another source."}
		}
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

	report("Selecting video file on Real Debrid…")
	if err := rd.SelectFiles(resolveCtx, torrentID, []int{file.ID}); err != nil {
		return nil, mapRDError(err)
	}

	report("Waiting for Real Debrid download…")
	info, err = rd.WaitReady(resolveCtx, torrentID, timeout, nil, report)
	if err != nil {
		if resolveCtx.Err() != nil {
			return nil, &ResolveError{Code: "timeout", Message: "Real Debrid torrent timed out."}
		}
		return nil, mapRDError(err)
	}
	if len(info.Links) == 0 {
		return nil, &ResolveError{Code: "no_links", Message: "Real Debrid returned no links."}
	}

	report("Unrestricting Real Debrid link…")
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
		Files: []StreamFile{{
			Index:    0,
			FileID:   file.ID,
			Filename: unrestricted.Filename,
			URL:      unrestricted.Download,
			Filesize: unrestricted.Filesize,
		}},
		PackKind: string(realdebrid.PackSingle),
	}, nil
}

func (s *Service) resolveBook(
	ctx context.Context,
	token, magnet string,
	req ResolveRequest,
	report func(string),
) (*StreamResult, error) {
	rd := realdebrid.NewClientWithToken(s.cfg, token)
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

	report("Adding magnet to Real Debrid…")
	id, err := rd.AddMagnet(resolveCtx, magnet)
	if err != nil {
		return nil, mapRDError(err)
	}
	torrentID = id
	cleanupTorrent = true
	report("Magnet added to Real Debrid. Waiting for file list…")

	info, err := rd.WaitForFileList(resolveCtx, torrentID, timeout)
	if err != nil {
		if resolveCtx.Err() != nil {
			return nil, &ResolveError{Code: "timeout", Message: "Real Debrid timed out while fetching torrent metadata. Try another source."}
		}
		return nil, mapRDError(err)
	}

	kind := realdebrid.MediaKindAudiobook
	if req.Type == "ebook" {
		kind = realdebrid.MediaKindEbook
	}

	mediaFiles := realdebrid.FilterMediaFiles(info.Files, kind)
	if len(mediaFiles) == 0 {
		return nil, &ResolveError{
			Code:    "title_mismatch",
			Message: fmt.Sprintf("No %s files found in this torrent (%d files total). Try another source.", req.Type, len(info.Files)),
		}
	}

	if kind == realdebrid.MediaKindEbook {
		// Prefer a single best ebook (epub > pdf) unless the user asked for a pack.
		mediaFiles = realdebrid.PreferEbookFiles(mediaFiles)
		if req.FileIdx == nil {
			mediaFiles = mediaFiles[:1]
		}
	}

	// Optional single-file override via fileIdx into the filtered list.
	if req.FileIdx != nil {
		idx := *req.FileIdx
		if idx < 0 || idx >= len(mediaFiles) {
			return nil, &ResolveError{Code: "invalid_request", Message: "fileIdx is out of range for this pack"}
		}
		mediaFiles = []realdebrid.TorrentFile{mediaFiles[idx]}
	}

	fileIDs := make([]int, len(mediaFiles))
	for i, file := range mediaFiles {
		fileIDs[i] = file.ID
	}
	report(fmt.Sprintf("Selecting %d %s file(s) on Real Debrid…", len(fileIDs), req.Type))
	if err := rd.SelectFiles(resolveCtx, torrentID, fileIDs); err != nil {
		return nil, mapRDError(err)
	}

	report("Waiting for Real Debrid download…")
	info, err = rd.WaitReady(resolveCtx, torrentID, timeout, nil, report)
	if err != nil {
		if resolveCtx.Err() != nil {
			return nil, &ResolveError{Code: "timeout", Message: "Real Debrid torrent timed out."}
		}
		return nil, mapRDError(err)
	}
	if len(info.Links) == 0 {
		return nil, &ResolveError{Code: "no_links", Message: "Real Debrid returned no links."}
	}

	// RD returns links for selected files in torrent file-list order.
	selectedOrdered := make([]realdebrid.TorrentFile, 0, len(mediaFiles))
	selectedSet := map[int]realdebrid.TorrentFile{}
	for _, file := range mediaFiles {
		selectedSet[file.ID] = file
	}
	for _, file := range info.Files {
		if _, ok := selectedSet[file.ID]; ok {
			selectedOrdered = append(selectedOrdered, file)
		}
	}
	if len(selectedOrdered) == 0 {
		selectedOrdered = mediaFiles
	}

	if len(info.Links) < len(selectedOrdered) {
		return nil, &ResolveError{
			Code:    "no_links",
			Message: fmt.Sprintf("Real Debrid returned %d links for %d selected files.", len(info.Links), len(selectedOrdered)),
		}
	}

	report(fmt.Sprintf("Unrestricting %d Real Debrid link(s)…", len(selectedOrdered)))
	streamFiles := make([]StreamFile, 0, len(selectedOrdered))
	for index, file := range selectedOrdered {
		unrestricted, unrestrictErr := rd.UnrestrictLink(resolveCtx, info.Links[index])
		if unrestrictErr != nil {
			return nil, mapRDError(unrestrictErr)
		}
		filename := unrestricted.Filename
		if filename == "" {
			filename = filepath.Base(file.Path)
		}
		streamFiles = append(streamFiles, StreamFile{
			Index:    index,
			FileID:   file.ID,
			Filename: filename,
			URL:      unrestricted.Download,
			Filesize: unrestricted.Filesize,
			MimeType: realdebrid.MimeForFilename(filename),
		})
	}

	packKind := realdebrid.ClassifyPack(selectedOrdered)
	first := streamFiles[0]
	return &StreamResult{
		URL:       first.URL,
		DirectURL: first.URL,
		Filename:  first.Filename,
		Filesize:  first.Filesize,
		Mode:      "direct",
		Files:     streamFiles,
		PackKind:  string(packKind),
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
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "timed out") {
		return &ResolveError{Code: "timeout", Message: "Real Debrid torrent timed out."}
	}
	if strings.Contains(lower, "magnet_error") {
		return &ResolveError{
			Code:    "magnet_error",
			Message: "Real Debrid could not resolve this magnet (bad hash or unreachable trackers). Try another source.",
		}
	}
	if strings.Contains(lower, "torrent failed: dead") || strings.Contains(lower, "torrent failed: error") {
		return &ResolveError{
			Code:    "no_links",
			Message: "Real Debrid marked this torrent as failed/dead. Try another source.",
		}
	}
	if strings.Contains(lower, "torrent failed: virus") {
		return &ResolveError{Code: "infringing_file", Message: "Real Debrid blocked this torrent (virus flag). Try another source."}
	}
	// Surface raw RD API details instead of a generic gateway failure.
	return &ResolveError{Code: "no_links", Message: msg}
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
