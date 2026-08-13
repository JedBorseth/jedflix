package musicbrainz

import (
	"context"
	"fmt"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musicai"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz/local"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func (c *Client) searchHybrid(ctx context.Context, query string) (*musiccatalog.SearchResponse, error) {
	if !c.useLocalStore() {
		return nil, nil
	}
	if !c.local.SearchReady(ctx) {
		return nil, nil
	}

	var queryVec []float32
	if c.ai != nil && c.ai.Configured() {
		if vec, err := c.ai.EmbedQuery(ctx, query); err == nil {
			queryVec = vec
		}
	}

	hybrid, err := c.local.HybridSearch(ctx, query, queryVec, defaultLimit)
	if err != nil {
		return nil, err
	}

	hits := hybrid.Hits
	if c.enricher != nil && c.enricher.Configured() {
		hits = c.mergeLastFMSearchHits(ctx, query, hits)
	}

	if c.ai != nil && c.ai.Configured() && len(hits) > 1 {
		hits = c.rerankHits(ctx, query, hits)
	}

	result := local.HitsToResult(hits, defaultLimit)
	artists := c.withArtistImageURLs(result.Artists)
	albums := c.withCoverURLs(result.Albums)
	tracks := c.withTrackCoverURLs(ctx, result.Tracks)
	ranked := make([]musiccatalog.RankedHit, 0, len(result.Ranked))
	for _, hit := range result.Ranked {
		ranked = append(ranked, musiccatalog.RankedHit{Kind: hit.Kind, ID: hit.ID, Score: hit.Score})
	}
	return &musiccatalog.SearchResponse{
		Albums:  albums,
		Artists: artists,
		Tracks:  tracks,
		Ranked:  ranked,
	}, nil
}

func (c *Client) mergeLastFMSearchHits(ctx context.Context, query string, hits []local.SearchHit) []local.SearchHit {
	lfmCtx, cancel := context.WithTimeout(ctx, lastFMTopTracksTimeout)
	defer cancel()
	lfmTracks, err := c.enricher.SearchTracks(lfmCtx, query, 8)
	if err != nil || len(lfmTracks) == 0 {
		return hits
	}
	existing := map[string]struct{}{}
	for _, hit := range hits {
		existing[hit.EntityType+":"+hit.MBID] = struct{}{}
		existing["name:"+local.NormalizeSearchText(hit.Name)+"|"+local.NormalizeSearchText(strings.Join(hit.Artists, " "))] = struct{}{}
	}
	for i, track := range lfmTracks {
		id := strings.TrimSpace(track.ID)
		if id == "" && len(track.Artists) > 0 {
			if resolved, err := c.ResolveTrackByName(ctx, track.Name, track.Artists[0]); err == nil && resolved != nil {
				track = *resolved
				id = track.ID
			}
		}
		if id == "" {
			continue
		}
		key := "track:" + id
		nameKey := "name:" + local.NormalizeSearchText(track.Name) + "|" + local.NormalizeSearchText(strings.Join(track.Artists, " "))
		if _, ok := existing[key]; ok {
			continue
		}
		if _, ok := existing[nameKey]; ok {
			continue
		}
		existing[key] = struct{}{}
		existing[nameKey] = struct{}{}
		hits = append(hits, local.SearchHit{
			EntityType: "track",
			MBID:       id,
			Name:       track.Name,
			Artists:    track.Artists,
			ArtistIDs:  track.ArtistIDs,
			AlbumName:  track.AlbumName,
			AlbumID:    track.AlbumID,
			DurationMs: track.DurationMs,
			Lexical:    0.4 - float64(i)*0.01,
			Fused:      0.012 - float64(i)*0.0005,
			EmbedText:  local.DocumentText("track", track.Name, track.Artists, track.AlbumName, nil, nil, nil),
		})
	}
	return hits
}

func (c *Client) rerankHits(ctx context.Context, query string, hits []local.SearchHit) []local.SearchHit {
	docs := make([]musicai.RerankDocument, 0, len(hits))
	byID := map[string]local.SearchHit{}
	for i, hit := range hits {
		id := fmt.Sprintf("%s:%s", hit.EntityType, hit.MBID)
		if hit.MBID == "" {
			id = fmt.Sprintf("%s:#%d", hit.EntityType, i)
		}
		byID[id] = hit
		docs = append(docs, musicai.RerankDocument{ID: id, Text: local.HitEmbedText(hit)})
	}
	ranked, err := c.ai.Rerank(ctx, query, docs)
	if err != nil || len(ranked) == 0 {
		return hits
	}
	out := make([]local.SearchHit, 0, len(ranked))
	seen := map[string]struct{}{}
	for i, item := range ranked {
		hit, ok := byID[item.ID]
		if !ok {
			continue
		}
		hit.Fused = item.Score
		// Keep exact lexical matches near the top even if the reranker is noisy.
		if local.NormalizeSearchText(hit.Name) == local.NormalizeSearchText(query) {
			hit.Fused += 2
		}
		hit.Fused -= float64(i) * 0.0001
		out = append(out, hit)
		seen[item.ID] = struct{}{}
	}
	for id, hit := range byID {
		if _, ok := seen[id]; ok {
			continue
		}
		out = append(out, hit)
	}
	return local.MergeHits(query, out, nil, len(out))
}
