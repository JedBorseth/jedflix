package resolver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/abb"
	"github.com/jedborseth/jeds-movies/backend/internal/bookchapters"
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
	Author          string          `json:"author,omitempty"`
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
	// Chapters inside this one file (single-file audiobooks).
	Chapters      []bookchapters.Chapter `json:"chapters,omitempty"`
	ChapterSource string                 `json:"chapterSource,omitempty"`
}

type StreamResult struct {
	URL       string       `json:"url"`
	DirectURL string       `json:"directUrl,omitempty"`
	Filename  string       `json:"filename,omitempty"`
	Filesize  int64        `json:"filesize,omitempty"`
	Mode      string       `json:"mode"`
	Files     []StreamFile `json:"files,omitempty"`
	PackKind  string       `json:"packKind,omitempty"`
	Magnet    string       `json:"magnet,omitempty"`
	InfoHash  string       `json:"infoHash,omitempty"`
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
	abb        *abb.Client
	filterOpts search.FilterOptions
	chapters   chapterFinder
	// newRD overrides the Real Debrid client (tests).
	newRD func(token string) *realdebrid.Client
}

func NewService(cfg config.Config, searcher search.Searcher, abbClient *abb.Client) *Service {
	return &Service{
		cfg:        cfg,
		searcher:   searcher,
		abb:        abbClient,
		filterOpts: search.FilterOptionsFromConfig(cfg),
		chapters: bookchapters.NewFinder(bookchapters.Options{
			HTTPClient: cfg.HTTPClient(),
		}),
	}
}

func (s *Service) ListSources(ctx context.Context, req Request) ([]Source, error) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	switch req.Type {
	case "audiobook", "ebook":
		return s.listBookSources(ctx, req)
	case "movie", "tv", "":
		return s.listVideoSources(ctx, req)
	default:
		return nil, fmt.Errorf("unsupported type %q", req.Type)
	}
}

// User-facing outcomes of a video source search that found nothing playable.
var (
	ErrNoBrowserCompatibleStreams = errors.New("no browser-compatible streams found (MKV/Remux/Atmos/DTS filtered)")
	ErrNoStreams                  = errors.New("no streams passed filters")
	ErrSourceSearchUnavailable    = errors.New("stream search is temporarily unavailable")
)

func (s *Service) listVideoSources(ctx context.Context, req Request) ([]Source, error) {
	if strings.TrimSpace(req.IMDbID) == "" {
		return nil, fmt.Errorf("imdbId is required")
	}
	if req.Type == "tv" && (req.Season == nil || req.Episode == nil) {
		return nil, fmt.Errorf("season and episode are required for tv")
	}

	releases, err := s.search(ctx, req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: %v", ErrSourceSearchUnavailable, err)
	}

	opts := s.filterOpts
	opts.RequireDirectPlaybackCompat = req.PlaybackProfile != PlaybackExternal
	opts.EpisodeSearch = req.Type == "tv"
	filtered := search.FilterReleases(releases, opts)
	if len(filtered) == 0 {
		if opts.RequireDirectPlaybackCompat {
			relaxed := opts
			relaxed.RequireDirectPlaybackCompat = false
			if len(search.FilterReleases(releases, relaxed)) > 0 {
				return nil, ErrNoBrowserCompatibleStreams
			}
		}
		return nil, ErrNoStreams
	}

	ranked := search.ScorePick(filtered)
	return toSources(dedupeReleases(ranked)), nil
}

func (s *Service) listBookSources(ctx context.Context, req Request) ([]Source, error) {
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

	ranked, err := s.searchAndRankBooks(ctx, query, title, author)
	if err != nil {
		return nil, err
	}
	// Prefer a title-only search when the combined query produced nothing useful.
	if len(ranked) == 0 && title != "" && !strings.EqualFold(strings.TrimSpace(query), title) {
		ranked, err = s.searchAndRankBooks(ctx, title, title, author)
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
	s.enrichBookMagnets(ctx, sources, 5)
	// Audiobook picker shows RD seeder counts (red when < 3 on the web client).
	if req.Type == "audiobook" && strings.TrimSpace(req.RealDebridToken) != "" {
		s.enrichBookSeedersFromRD(ctx, sources, 3, req.RealDebridToken)
	}
	return sources, nil
}

func (s *Service) enrichBookMagnets(ctx context.Context, sources []Source, limit int) {
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
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()

			post, err := s.abb.GetPost(ctx, sources[index].AbbPostURL)
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

// enrichBookSeedersFromRD marks sources already in the user's account as
// cached, and briefly adds the others to Real Debrid to read swarm seeders
// for the audiobook stream picker, deleting only those probe copies.
func (s *Service) enrichBookSeedersFromRD(ctx context.Context, sources []Source, limit int, token string) {
	token = strings.TrimSpace(token)
	if token == "" || limit <= 0 {
		return
	}
	if limit > len(sources) {
		limit = len(sources)
	}

	rd := s.rdClient(token)
	// Torrents already in the account are cached for this user, and the probe
	// must never add or delete a copy of them.
	var owned map[string][]realdebrid.TorrentSummary
	lookupCtx, cancelLookup := context.WithTimeout(ctx, 5*time.Second)
	if torrents, err := rd.ListTorrents(lookupCtx); err == nil {
		owned = realdebrid.TorrentsByHash(torrents)
	}
	cancelLookup()
	for i := range sources {
		hash := strings.ToLower(sources[i].InfoHash)
		if hash == "" {
			hash = strings.ToLower(infoHashFromMagnet(sources[i].Magnet))
		}
		for _, torrent := range owned[hash] {
			if torrent.Status == "downloaded" {
				sources[i].Cached = true
			}
		}
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, 2)
	for i := 0; i < limit; i++ {
		magnet := strings.TrimSpace(sources[i].Magnet)
		if magnet == "" {
			continue
		}
		if owned == nil {
			// Could not check the account; skip probes rather than risk
			// deleting a torrent the user keeps.
			break
		}
		if _, inAccount := owned[strings.ToLower(infoHashFromMagnet(magnet))]; inAccount {
			continue
		}
		wg.Add(1)
		go func(index int, magnetURL string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()

			seeders, ok := probeRDSeeders(ctx, rd, magnetURL)
			if !ok {
				return
			}
			sources[index].Seeders = &seeders
		}(i, magnet)
	}
	wg.Wait()
}

func probeRDSeeders(ctx context.Context, rd *realdebrid.Client, magnet string) (int, bool) {
	if ctx.Err() != nil {
		return 0, false
	}
	// The add is not tied to the request: if the caller goes away after Real
	// Debrid accepts the magnet, we still need the ID to delete the probe.
	addCtx, cancelAdd := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	torrentID, err := rd.AddMagnet(addCtx, magnet)
	cancelAdd()
	if err != nil || torrentID == "" {
		// Real Debrid may have created the torrent before the error (a
		// timeout or 5xx). The hash was not in the account before the probe,
		// so any unstarted copy now is ours.
		log.Printf("real-debrid: seeder probe add failed: %v", err)
		go sweepProbeCopies(rd, infoHashFromMagnet(magnet))
		return 0, false
	}
	// Off the request path: deletes are retried with backoff.
	defer func() { go cleanupRDTorrent(rd, torrentID) }()

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

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
		case <-time.After(700 * time.Millisecond):
		}
	}
	return 0, false
}

// cleanupRDTorrent removes a torrent this backend added and will not use.
// A failed delete leaves an unstarted torrent in the user's account, so it is
// retried; "not found" means it is already gone.
func cleanupRDTorrent(rd *realdebrid.Client, torrentID string) {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		err = rd.DeleteTorrent(ctx, torrentID)
		cancel()
		if err == nil || realdebrid.IsNotFoundError(err) {
			return
		}
	}
	log.Printf("real-debrid: could not remove torrent %s: %v", torrentID, err)
}

// sweepProbeCopies deletes unstarted copies of a hash the account did not
// hold before probing. Torrents with files selected are left alone: those are
// real plays started meanwhile.
func sweepProbeCopies(rd *realdebrid.Client, hash string) {
	hash = strings.ToLower(strings.TrimSpace(hash))
	if hash == "" {
		return
	}
	time.Sleep(time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	torrents, err := rd.ListTorrents(ctx)
	cancel()
	if err != nil {
		return
	}
	for _, torrent := range realdebrid.TorrentsByHash(torrents)[hash] {
		switch torrent.Status {
		case "magnet_conversion", "waiting_files_selection":
			cleanupRDTorrent(rd, torrent.ID)
		}
	}
}

func compactMagnetURI(magnet, hash string) string {
	if hash != "" {
		return "magnet:?xt=urn:btih:" + hash
	}
	return strings.TrimSpace(magnet)
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

func (s *Service) searchAndRankBooks(ctx context.Context, query, title, author string) ([]abb.RankedResult, error) {
	results, err := s.abb.Search(ctx, query)
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
		post, err := s.abb.GetPost(ctx, strings.TrimSpace(req.AbbPostURL))
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
	rd := s.rdClient(token)
	maxBytes := int64(s.cfg.MaxVideoSizeGB * 1024 * 1024 * 1024)
	timeout := s.resolveTimeout()

	resolveCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	pick := func(files []realdebrid.TorrentFile) ([]realdebrid.TorrentFile, error) {
		var file realdebrid.TorrentFile
		var ok bool
		if req.Type == "tv" && req.Season != nil && req.Episode != nil {
			file, ok = realdebrid.PickEpisodeFile(files, *req.Season, *req.Episode, req.FileIdx)
		} else {
			file, ok = realdebrid.PickMovieFile(files, req.MediaTitle, req.FileIdx)
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
		return []realdebrid.TorrentFile{file}, nil
	}

	lease, err := s.acquireTorrent(resolveCtx, rd, magnet, timeout, pick, report)
	if err != nil {
		return nil, err
	}
	links, err := s.waitAndLink(resolveCtx, rd, lease, timeout, report)
	if err != nil {
		return nil, err
	}

	report("Unrestricting Real Debrid link…")
	unrestricted, err := rd.UnrestrictLink(resolveCtx, links[0])
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
			FileID:   lease.files[0].ID,
			Filename: unrestricted.Filename,
			URL:      unrestricted.Download,
			Filesize: unrestricted.Filesize,
		}},
		PackKind: string(realdebrid.PackSingle),
	}, nil
}

func (s *Service) resolveTimeout() time.Duration {
	if s.cfg.ResolveTimeout > 0 {
		return s.cfg.ResolveTimeout
	}
	return 10 * time.Minute
}

func (s *Service) resolveBook(
	ctx context.Context,
	token, magnet string,
	req ResolveRequest,
	report func(string),
) (*StreamResult, error) {
	rd := s.rdClient(token)
	timeout := s.resolveTimeout()

	resolveCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	kind := realdebrid.MediaKindAudiobook
	if req.Type == "ebook" {
		kind = realdebrid.MediaKindEbook
	}

	pick := func(files []realdebrid.TorrentFile) ([]realdebrid.TorrentFile, error) {
		mediaFiles := realdebrid.FilterMediaFiles(files, kind)
		if len(mediaFiles) == 0 {
			return nil, &ResolveError{
				Code:    "title_mismatch",
				Message: fmt.Sprintf("No %s files found in this torrent (%d files total). Try another source.", req.Type, len(files)),
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
		// Keep torrent file-list order; playback order is applied after linking.
		return realdebrid.AlignSelectedWithLinks(files, mediaFiles), nil
	}

	lease, err := s.acquireTorrent(resolveCtx, rd, magnet, timeout, pick, report)
	if err != nil {
		return nil, err
	}
	links, err := s.waitAndLink(resolveCtx, rd, lease, timeout, report)
	if err != nil {
		return nil, err
	}

	// Real Debrid's link order is torrent file-list order, which is often not
	// listening order. Pair first, then sort by path.
	selectedOrdered, playbackLinks := realdebrid.SortPlaybackLinks(lease.files, links)

	report(fmt.Sprintf("Unrestricting %d Real Debrid link(s)…", len(selectedOrdered)))
	streamFiles := make([]StreamFile, 0, len(selectedOrdered))
	for index, file := range selectedOrdered {
		unrestricted, unrestrictErr := rd.UnrestrictLink(resolveCtx, playbackLinks[index])
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

	hash := infoHashFromMagnet(magnet)
	if kind == realdebrid.MediaKindAudiobook {
		s.attachChapters(resolveCtx, hash, req, streamFiles, report)
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
		Magnet:    compactMagnetURI(magnet, hash),
		InfoHash:  hash,
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

// dedupeReleases keeps the best-ranked row for each torrent file.
func dedupeReleases(releases []search.Release) []search.Release {
	seen := make(map[string]struct{}, len(releases))
	out := releases[:0:0]
	for _, release := range releases {
		key := release.InfoHash
		if release.FileIdx != nil {
			key = fmt.Sprintf("%s:%d", key, *release.FileIdx)
		}
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, release)
	}
	return out
}

func toSources(releases []search.Release) []Source {
	sources := make([]Source, 0, len(releases))
	for index, release := range releases {
		source := Source{
			ID:       fmt.Sprintf("src_%d_%s", index, release.InfoHash),
			Title:    release.Title,
			Info:     release.Info,
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
