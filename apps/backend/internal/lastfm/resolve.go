package lastfm

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"sync"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

var nonAlnumPattern = regexp.MustCompile(`[^a-z0-9]+`)

const (
	defaultSimilarArtists = 4
	defaultSimilarTracks  = 6
	maxSimilarArtists     = 6
	maxSimilarTracks      = 6
	maxSimilarPool        = 25
)

// CatalogSearcher resolves Last.fm name hits into catalog objects (MusicBrainz).
type CatalogSearcher interface {
	Configured() bool
	Search(ctx context.Context, query string) (*musiccatalog.SearchResponse, error)
}

// CatalogNamer is a fast exact-name resolve path. Hybrid search is too slow
// to use once per Last.fm similar-track hit.
type CatalogNamer interface {
	ResolveArtistByName(ctx context.Context, name string) (*musiccatalog.Artist, error)
	ResolveTrackByName(ctx context.Context, name, artist string) (*musiccatalog.TopTrack, error)
}

// Service resolves Last.fm recommendations into catalog objects.
type Service struct {
	lastfm  *Client
	catalog CatalogSearcher

	resolveMu   sync.Mutex
	artistCache map[string]*musiccatalog.Artist
	trackCache  map[string]*musiccatalog.TopTrack
}

func NewService(lastfmClient *Client, catalog CatalogSearcher) *Service {
	return &Service{
		lastfm:      lastfmClient,
		catalog:     catalog,
		artistCache: make(map[string]*musiccatalog.Artist),
		trackCache:  make(map[string]*musiccatalog.TopTrack),
	}
}

func (s *Service) Configured() bool {
	return s != nil && s.lastfm != nil && s.lastfm.Configured()
}

func (s *Service) canResolve() bool {
	return s.Configured() && s.catalog != nil && s.catalog.Configured()
}

func (s *Service) SimilarArtists(ctx context.Context, artist string, limit int) ([]musiccatalog.Artist, error) {
	if !s.canResolve() {
		return nil, ErrNotConfigured
	}
	return s.similarArtists(ctx, artist, clampResolveLimit(limit, defaultSimilarArtists, maxSimilarArtists))
}

func (s *Service) SimilarArtistsWide(ctx context.Context, artist string, limit int) ([]musiccatalog.Artist, error) {
	if !s.canResolve() {
		return nil, ErrNotConfigured
	}
	return s.similarArtists(ctx, artist, clampResolveLimit(limit, 8, maxSimilarPool))
}

func (s *Service) similarArtists(ctx context.Context, artist string, limit int) ([]musiccatalog.Artist, error) {
	raw, err := s.lastfm.GetSimilarArtists(ctx, artist, limit)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	excludeName := normalizeName(artist)
	out := make([]musiccatalog.Artist, 0, len(raw))
	for _, item := range raw {
		if ctx.Err() != nil {
			break
		}
		if normalizeName(item.Name) == excludeName {
			continue
		}
		resolved, err := s.resolveArtist(ctx, item.Name)
		if err != nil {
			if errors.Is(err, musiccatalog.ErrRateLimited) {
				break
			}
			continue
		}
		if resolved == nil || resolved.ID == "" {
			continue
		}
		if _, ok := seen[resolved.ID]; ok {
			continue
		}
		seen[resolved.ID] = struct{}{}
		out = append(out, *resolved)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *Service) SimilarTracks(ctx context.Context, artist, track string, limit int) ([]musiccatalog.TopTrack, error) {
	if !s.canResolve() {
		return nil, ErrNotConfigured
	}
	return s.similarTracks(ctx, artist, track, clampResolveLimit(limit, defaultSimilarTracks, maxSimilarTracks))
}

func (s *Service) SimilarTracksWide(ctx context.Context, artist, track string, limit int) ([]musiccatalog.TopTrack, error) {
	if !s.canResolve() {
		return nil, ErrNotConfigured
	}
	return s.similarTracks(ctx, artist, track, clampResolveLimit(limit, 12, maxSimilarPool))
}

func (s *Service) similarTracks(ctx context.Context, artist, track string, limit int) ([]musiccatalog.TopTrack, error) {
	raw, err := s.lastfm.GetSimilarTracks(ctx, artist, track, limit)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	excludeKey := trackKey(artist, track)
	out := make([]musiccatalog.TopTrack, 0, len(raw))
	for _, item := range raw {
		if ctx.Err() != nil {
			break
		}
		if trackKey(item.Artist, item.Name) == excludeKey {
			continue
		}
		resolved, err := s.resolveTrack(ctx, item.Artist, item.Name)
		if err != nil {
			if errors.Is(err, musiccatalog.ErrRateLimited) {
				break
			}
			continue
		}
		if resolved == nil || resolved.ID == "" {
			continue
		}
		if _, ok := seen[resolved.ID]; ok {
			continue
		}
		seen[resolved.ID] = struct{}{}
		out = append(out, *resolved)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *Service) ArtistTags(ctx context.Context, artist string) ([]Tag, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	return s.lastfm.GetArtistTopTags(ctx, artist)
}

// RelatedForAlbum mixes similar tracks (from album tracks) and similar artists.
func (s *Service) RelatedForAlbum(
	ctx context.Context,
	artist string,
	seedTracks []struct{ Artist, Track string },
	limit int,
) (artists []musiccatalog.Artist, tracks []musiccatalog.TopTrack, err error) {
	if !s.canResolve() {
		return nil, nil, ErrNotConfigured
	}
	if limit <= 0 {
		limit = 6
	}
	artistLimit := min(limit, maxSimilarArtists)
	trackLimit := min(limit, maxSimilarTracks)

	var artistErr, trackErr error

	if strings.TrimSpace(artist) != "" {
		artists, artistErr = s.SimilarArtists(ctx, artist, artistLimit)
	}

	seen := make(map[string]struct{})
	collected := make([]musiccatalog.TopTrack, 0, trackLimit)
	seeds := seedTracks
	if len(seeds) > 1 {
		seeds = seeds[:1]
	}
	for _, seed := range seeds {
		if ctx.Err() != nil {
			break
		}
		a := strings.TrimSpace(seed.Artist)
		t := strings.TrimSpace(seed.Track)
		if a == "" || t == "" {
			continue
		}
		hits, err := s.SimilarTracks(ctx, a, t, trackLimit)
		if err != nil {
			trackErr = err
			if errors.Is(err, musiccatalog.ErrRateLimited) {
				break
			}
			continue
		}
		for _, hit := range hits {
			if _, ok := seen[hit.ID]; ok {
				continue
			}
			seen[hit.ID] = struct{}{}
			collected = append(collected, hit)
			if len(collected) >= trackLimit {
				break
			}
		}
		if len(collected) >= trackLimit {
			break
		}
	}
	tracks = collected

	if len(artists) == 0 && len(tracks) == 0 {
		if artistErr != nil {
			return nil, nil, artistErr
		}
		if trackErr != nil {
			return nil, nil, trackErr
		}
	}
	return artists, tracks, nil
}

func (s *Service) resolveArtist(ctx context.Context, name string) (*musiccatalog.Artist, error) {
	key := normalizeName(name)
	if key == "" {
		return nil, nil
	}

	s.resolveMu.Lock()
	if cached, ok := s.artistCache[key]; ok {
		s.resolveMu.Unlock()
		return cached, nil
	}
	s.resolveMu.Unlock()

	if namer, ok := s.catalog.(CatalogNamer); ok {
		resolved, err := namer.ResolveArtistByName(ctx, name)
		if err == nil && resolved != nil {
			copy := *resolved
			s.resolveMu.Lock()
			s.artistCache[key] = &copy
			s.resolveMu.Unlock()
			return &copy, nil
		}
		// Hybrid search is too slow to run once per Last.fm similar-artist hit.
		return nil, nil
	}

	result, err := s.catalog.Search(ctx, name)
	if err != nil {
		return nil, err
	}

	best := pickBestArtist(name, result)
	s.resolveMu.Lock()
	s.artistCache[key] = best
	s.resolveMu.Unlock()
	return best, nil
}

func (s *Service) resolveTrack(ctx context.Context, artist, track string) (*musiccatalog.TopTrack, error) {
	key := trackKey(artist, track)
	if key == "" {
		return nil, nil
	}

	s.resolveMu.Lock()
	if cached, ok := s.trackCache[key]; ok {
		s.resolveMu.Unlock()
		return cached, nil
	}
	s.resolveMu.Unlock()

	if namer, ok := s.catalog.(CatalogNamer); ok {
		resolved, err := namer.ResolveTrackByName(ctx, track, artist)
		if err == nil && resolved != nil {
			copy := *resolved
			s.resolveMu.Lock()
			s.trackCache[key] = &copy
			s.resolveMu.Unlock()
			return &copy, nil
		}
		// Hybrid search is too slow to run once per Last.fm similar-track hit.
		return nil, nil
	}

	result, err := s.catalog.Search(ctx, track+" "+artist)
	if err != nil {
		return nil, err
	}

	best := pickBestTrack(artist, track, result)
	s.resolveMu.Lock()
	s.trackCache[key] = best
	s.resolveMu.Unlock()
	return best, nil
}

func pickBestArtist(name string, result *musiccatalog.SearchResponse) *musiccatalog.Artist {
	if result == nil || len(result.Artists) == 0 {
		return nil
	}
	target := normalizeName(name)
	var best *musiccatalog.Artist
	bestScore := -1
	for i := range result.Artists {
		artist := &result.Artists[i]
		score := nameMatchScore(target, normalizeName(artist.Name))
		if score > bestScore {
			bestScore = score
			best = artist
		}
	}
	if best == nil || bestScore < 40 {
		return nil
	}
	copy := *best
	return &copy
}

func pickBestTrack(artist, track string, result *musiccatalog.SearchResponse) *musiccatalog.TopTrack {
	if result == nil || len(result.Tracks) == 0 {
		return nil
	}
	targetTrack := normalizeName(track)
	targetArtist := normalizeName(artist)
	var best *musiccatalog.TopTrack
	bestScore := -1
	for i := range result.Tracks {
		item := &result.Tracks[i]
		score := nameMatchScore(targetTrack, normalizeName(item.Name))
		artistScore := 0
		for _, a := range item.Artists {
			artistScore = max(artistScore, nameMatchScore(targetArtist, normalizeName(a)))
		}
		score += artistScore / 2
		if score > bestScore {
			bestScore = score
			best = item
		}
	}
	if best == nil || bestScore < 50 {
		return nil
	}
	copy := *best
	return &copy
}

func nameMatchScore(target, candidate string) int {
	if target == "" || candidate == "" {
		return 0
	}
	if target == candidate {
		return 100
	}
	if strings.HasPrefix(candidate, target) || strings.HasPrefix(target, candidate) {
		return 80
	}
	if strings.Contains(candidate, target) || strings.Contains(target, candidate) {
		return 60
	}
	targetTokens := strings.Fields(target)
	candidateSet := make(map[string]struct{})
	for _, t := range strings.Fields(candidate) {
		candidateSet[t] = struct{}{}
	}
	hits := 0
	for _, t := range targetTokens {
		if _, ok := candidateSet[t]; ok {
			hits++
		}
	}
	if len(targetTokens) == 0 {
		return 0
	}
	if hits == len(targetTokens) {
		return 50
	}
	if hits > 0 {
		return 30 + hits*5
	}
	return 0
}

func normalizeName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = nonAlnumPattern.ReplaceAllString(value, " ")
	return strings.Join(strings.Fields(value), " ")
}

func trackKey(artist, track string) string {
	return normalizeName(artist) + "|" + normalizeName(track)
}

func clampResolveLimit(limit, def, maxVal int) int {
	if limit <= 0 {
		return def
	}
	if limit > maxVal {
		return maxVal
	}
	return limit
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
