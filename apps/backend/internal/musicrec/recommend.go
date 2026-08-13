package musicrec

import (
	"context"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/lastfm"
	"github.com/jedborseth/jeds-movies/backend/internal/musicai"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz/local"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

type SeedTrack struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Artists   []string `json:"artists"`
	AlbumName string   `json:"albumName"`
}

type Request struct {
	Seed              SeedTrack   `json:"seed"`
	Recent            []SeedTrack `json:"recent"`
	ExcludeIDs        []string    `json:"excludeIds"`
	RecentArtistNames []string    `json:"recentArtistNames"`
	Limit             int         `json:"limit"`
}

type Response struct {
	Tracks []musiccatalog.TopTrack `json:"tracks"`
}

type Service struct {
	catalog *musicbrainz.Client
	lastfm  *lastfm.Service
	ai      *musicai.Client
}

func New(catalog *musicbrainz.Client, lastfmService *lastfm.Service, ai *musicai.Client) *Service {
	return &Service{catalog: catalog, lastfm: lastfmService, ai: ai}
}

func (s *Service) Configured() bool {
	return s != nil && s.catalog != nil
}

func (s *Service) Recommend(ctx context.Context, req Request) (*Response, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = 6
	}
	if limit > 12 {
		limit = 12
	}
	exclude := map[string]struct{}{}
	for _, id := range req.ExcludeIDs {
		if id = strings.TrimSpace(id); id != "" {
			exclude[id] = struct{}{}
		}
	}
	exclude[strings.TrimSpace(req.Seed.ID)] = struct{}{}

	candidates := s.collectCandidates(ctx, req)
	candidates = dedupeTracks(candidates, exclude)
	if len(candidates) == 0 {
		return &Response{Tracks: []musiccatalog.TopTrack{}}, nil
	}

	ranked := candidates
	if s.ai != nil && s.ai.Configured() && len(candidates) > 1 {
		docs := make([]musicai.RerankDocument, 0, len(candidates))
		byID := map[string]musiccatalog.TopTrack{}
		query := recommendQuery(req)
		for _, track := range candidates {
			byID[track.ID] = track
			docs = append(docs, musicai.RerankDocument{
				ID:   track.ID,
				Text: local.DocumentText("track", track.Name, track.Artists, track.AlbumName, nil, nil, nil),
			})
		}
		if results, err := s.ai.Rerank(ctx, query, docs); err == nil && len(results) > 0 {
			next := make([]musiccatalog.TopTrack, 0, len(results))
			seen := map[string]struct{}{}
			for _, item := range results {
				track, ok := byID[item.ID]
				if !ok {
					continue
				}
				if _, dup := seen[track.ID]; dup {
					continue
				}
				seen[track.ID] = struct{}{}
				next = append(next, track)
			}
			if len(next) > 0 {
				ranked = next
			}
		}
	}

	picked := PickDiverse(ranked, req.RecentArtistNames, limit)
	return &Response{Tracks: picked}, nil
}

func (s *Service) collectCandidates(ctx context.Context, req Request) []musiccatalog.TopTrack {
	out := make([]musiccatalog.TopTrack, 0, 40)
	seedArtist := ""
	if len(req.Seed.Artists) > 0 {
		seedArtist = req.Seed.Artists[0]
	}

	if s.lastfm != nil && s.lastfm.Configured() && seedArtist != "" && req.Seed.Title != "" {
		if tracks, err := s.lastfm.SimilarTracksWide(ctx, seedArtist, req.Seed.Title, 16); err == nil {
			out = append(out, tracks...)
		}
		if artists, err := s.lastfm.SimilarArtistsWide(ctx, seedArtist, 4); err == nil {
			for i, artist := range artists {
				if i >= 3 || ctx.Err() != nil {
					break
				}
				if s.catalog == nil {
					break
				}
				details, err := s.catalog.GetArtist(ctx, artist.ID)
				if err != nil || details == nil {
					continue
				}
				for j, track := range details.TopTracks {
					if j >= 3 {
						break
					}
					out = append(out, track)
				}
			}
		}
	}

	if s.catalog != nil {
		if store := s.catalog.LocalStore(); store != nil && strings.TrimSpace(req.Seed.ID) != "" {
			if similar, err := store.SimilarTracks(ctx, req.Seed.ID, 16); err == nil {
				for _, hit := range similar {
					out = append(out, musiccatalog.TopTrack{
						ID:         hit.MBID,
						Name:       hit.Name,
						Artists:    hit.Artists,
						ArtistIDs:  hit.ArtistIDs,
						DurationMs: hit.DurationMs,
						AlbumID:    hit.AlbumID,
						AlbumName:  hit.AlbumName,
					})
				}
			}
		}
	}
	return out
}

func recommendQuery(req Request) string {
	parts := []string{"Recommend the next song after"}
	if req.Seed.Title != "" {
		parts = append(parts, req.Seed.Title)
	}
	if len(req.Seed.Artists) > 0 {
		parts = append(parts, "by", strings.Join(req.Seed.Artists, ", "))
	}
	parts = append(parts, ". Prefer variety, avoid repeating the same artist consecutively.")
	return strings.Join(parts, " ")
}

func dedupeTracks(tracks []musiccatalog.TopTrack, exclude map[string]struct{}) []musiccatalog.TopTrack {
	out := make([]musiccatalog.TopTrack, 0, len(tracks))
	seen := map[string]struct{}{}
	for k, v := range exclude {
		seen[k] = v
	}
	for _, track := range tracks {
		if track.ID == "" || track.Name == "" {
			continue
		}
		if _, ok := seen[track.ID]; ok {
			continue
		}
		nameKey := local.NormalizeSearchText(track.Name) + "|" + local.NormalizeSearchText(strings.Join(track.Artists, " "))
		if _, ok := seen[nameKey]; ok {
			continue
		}
		seen[track.ID] = struct{}{}
		seen[nameKey] = struct{}{}
		out = append(out, track)
	}
	return out
}

// PickDiverse greedily takes high-ranked tracks while spacing artists.
func PickDiverse(tracks []musiccatalog.TopTrack, recentArtists []string, limit int) []musiccatalog.TopTrack {
	if limit <= 0 {
		limit = 6
	}
	cooldown := map[string]struct{}{}
	for i, name := range recentArtists {
		if i >= 4 {
			break
		}
		key := local.NormalizeSearchText(name)
		if key != "" {
			cooldown[key] = struct{}{}
		}
	}
	out := make([]musiccatalog.TopTrack, 0, limit)
	used := map[string]struct{}{}
	pick := func(strict bool) {
		for _, track := range tracks {
			if len(out) >= limit {
				return
			}
			if _, ok := used[track.ID]; ok {
				continue
			}
			artistKey := ""
			if len(track.Artists) > 0 {
				artistKey = local.NormalizeSearchText(track.Artists[0])
			}
			if strict && artistKey != "" {
				if _, ok := cooldown[artistKey]; ok {
					continue
				}
				if _, ok := used["artist:"+artistKey]; ok {
					continue
				}
			}
			used[track.ID] = struct{}{}
			if artistKey != "" {
				used["artist:"+artistKey] = struct{}{}
				cooldown[artistKey] = struct{}{}
			}
			out = append(out, track)
		}
	}
	pick(true)
	if len(out) < limit {
		pick(false)
	}
	return out
}
