import { createTmdbClient } from "@jedflix/tmdb";

const client = createTmdbClient({
  apiKey: import.meta.env.VITE_TMDB_API_KEY ?? "",
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
} = client;

export {
  configureTmdb,
  createTmdbClient,
  getMediaDetailPath,
  getPersonPath,
  getWatchPath,
  mediaRows,
} from "@jedflix/tmdb";

export type { SearchResults, TvEpisode, TvSeasonSummary, TmdbClient, TmdbClientConfig } from "@jedflix/tmdb";
