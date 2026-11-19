package musicbrainz

import (
	"context"
	"strings"

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

	hybrid, err := c.local.HybridSearch(ctx, query, nil, defaultLimit)
	if err != nil {
		return nil, err
	}

	hits := hybrid.Hits
	if c.enricher != nil && c.enricher.Configured() && len(hits) < defaultLimit {
		hits = c.mergeLastFMSearchHits(ctx, query, hits)
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
		id := NormalizeMBID(track.ID)
		if id == "" {
			continue
		}
		track.ID = id
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
		})
	}
	return hits
}
