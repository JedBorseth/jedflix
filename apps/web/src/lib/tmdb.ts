import { createTmdbClient } from "@jedflix/tmdb";
import { getBackendApiBase } from "@/lib/backendEnv";

const client = createTmdbClient({
  backendBaseUrl: getBackendApiBase(),
});

export const {
  getTrendingMedia,
  discoverMedia,
  searchMedia,
  searchAll,
  getMediaCredits,
  getPersonDetails,
  getMediaDetails,
  getSimilarMedia,
  getMediaDetailsByIds,
  getExternalIds,
  getTvSeasons,
  getTvSeasonEpisodes,
  peekTrendingMedia,
  peekDiscoverMedia,
  clearTmdbSessionCache,
} = client;

export {
  configureTmdb,
  createTmdbClient,
  getMediaDetailPath,
  getPersonPath,
  getWatchPath,
  HOME_ROW_LIMIT,
  mediaRows,
  streamingProviderRows,
  WATCH_PROVIDER_IDS,
  DEFAULT_WATCH_REGION,
  buildHomeCatalogRows,
  buildMediaCatalogRows,
} from "@jedflix/tmdb";

export type {
  CatalogRow,
  DiscoverMediaOptions,
  SearchResults,
  TvEpisode,
  TvSeasonSummary,
  TmdbClient,
  TmdbClientConfig,
} from "@jedflix/tmdb";
