package lastfm

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/jedborseth/jeds-movies/backend/internal/spotify"
)

var nonAlnumPattern = regexp.MustCompile(`[^a-z0-9]+`)

// SpotifySearcher is the subset of the Spotify client needed to resolve Last.fm hits.
type SpotifySearcher interface {
	Configured() bool
	Search(ctx context.Context, query string) (*spotify.SearchResponse, error)
}

// Service resolves Last.fm recommendations into Spotify catalog objects.
type Service struct {
	lastfm  *Client
	spotify SpotifySearcher

	resolveMu   sync.Mutex
	artistCache map[string]*spotify.Artist
	trackCache  map[string]*spotify.TopTrack
}

func NewService(lastfmClient *Client, spotifyClient SpotifySearcher) *Service {
	return &Service{
		lastfm:      lastfmClient,
		spotify:     spotifyClient,
		artistCache: make(map[string]*spotify.Artist),
		trackCache:  make(map[string]*spotify.TopTrack),
	}
}

func (s *Service) Configured() bool {
	return s != nil && s.lastfm != nil && s.lastfm.Configured() &&
		s.spotify != nil && s.spotify.Configured()
}

func (s *Service) SimilarArtists(ctx context.Context, artist string, limit int) ([]spotify.Artist, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := s.lastfm.GetSimilarArtists(ctx, artist, limit)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	excludeName := normalizeName(artist)
	out := make([]spotify.Artist, 0, len(raw))
	for _, item := range raw {
		if normalizeName(item.Name) == excludeName {
			continue
		}
		resolved, err := s.resolveArtist(ctx, item.Name)
		if err != nil {
			if errors.Is(err, spotify.ErrRateLimited) {
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
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *Service) SimilarTracks(ctx context.Context, artist, track string, limit int) ([]spotify.TopTrack, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	raw, err := s.lastfm.GetSimilarTracks(ctx, artist, track, limit)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	excludeKey := trackKey(artist, track)
	out := make([]spotify.TopTrack, 0, len(raw))
	for _, item := range raw {
		if trackKey(item.Artist, item.Name) == excludeKey {
			continue
		}
		resolved, err := s.resolveTrack(ctx, item.Artist, item.Name)
		if err != nil {
			if errors.Is(err, spotify.ErrRateLimited) {
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
		if limit > 0 && len(out) >= limit {
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
) (artists []spotify.Artist, tracks []spotify.TopTrack, err error) {
	if !s.Configured() {
		return nil, nil, ErrNotConfigured
	}
	if limit <= 0 {
		limit = 12
	}

	artistLimit := min(limit, 12)
	trackLimit := min(limit, 16)

	var artistErr, trackErr error
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		if strings.TrimSpace(artist) == "" {
			return
		}
		artists, artistErr = s.SimilarArtists(ctx, artist, artistLimit)
	}()

	go func() {
		defer wg.Done()
		seen := make(map[string]struct{})
		collected := make([]spotify.TopTrack, 0, trackLimit)
		seeds := seedTracks
		if len(seeds) > 2 {
			seeds = seeds[:2]
		}
		perSeed := max(3, (trackLimit/max(1, len(seeds)))+1)
		for _, seed := range seeds {
			if ctx.Err() != nil {
				break
			}
			a := strings.TrimSpace(seed.Artist)
			t := strings.TrimSpace(seed.Track)
			if a == "" || t == "" {
				continue
			}
			hits, err := s.SimilarTracks(ctx, a, t, perSeed)
			if err != nil {
				trackErr = err
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
	}()

	wg.Wait()
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

func (s *Service) resolveArtist(ctx context.Context, name string) (*spotify.Artist, error) {
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

	query := fmt.Sprintf(`artist:"%s"`, escapeSearchQuotes(name))
	result, err := s.spotify.Search(ctx, query)
	if err != nil {
		if errors.Is(err, spotify.ErrRateLimited) {
			return nil, err
		}
		// Fall back to plain name search.
		result, err = s.spotify.Search(ctx, name)
		if err != nil {
			return nil, err
		}
	}

	best := pickBestArtist(name, result)
	s.resolveMu.Lock()
	s.artistCache[key] = best
	s.resolveMu.Unlock()
	return best, nil
}

func (s *Service) resolveTrack(ctx context.Context, artist, track string) (*spotify.TopTrack, error) {
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

	query := fmt.Sprintf(`track:"%s" artist:"%s"`, escapeSearchQuotes(track), escapeSearchQuotes(artist))
	result, err := s.spotify.Search(ctx, query)
	if err != nil {
		if errors.Is(err, spotify.ErrRateLimited) {
			return nil, err
		}
		result, err = s.spotify.Search(ctx, track+" "+artist)
		if err != nil {
			return nil, err
		}
	}

	best := pickBestTrack(artist, track, result)
	s.resolveMu.Lock()
	s.trackCache[key] = best
	s.resolveMu.Unlock()
	return best, nil
}

func pickBestArtist(name string, result *spotify.SearchResponse) *spotify.Artist {
	if result == nil || len(result.Artists) == 0 {
		return nil
	}
	target := normalizeName(name)
	var best *spotify.Artist
	bestScore := -1
	for i := range result.Artists {
		artist := &result.Artists[i]
		score := nameMatchScore(target, normalizeName(artist.Name))
		if score > bestScore {
			bestScore = score
			best = artist
		}
	}
	// Require at least a token-level match so we don't return unrelated artists.
	if best == nil || bestScore < 40 {
		return nil
	}
	copy := *best
	return &copy
}

func pickBestTrack(artist, track string, result *spotify.SearchResponse) *spotify.TopTrack {
	if result == nil || len(result.Tracks) == 0 {
		return nil
	}
	targetTrack := normalizeName(track)
	targetArtist := normalizeName(artist)
	var best *spotify.TopTrack
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

func escapeSearchQuotes(value string) string {
	return strings.ReplaceAll(value, `"`, ``)
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
