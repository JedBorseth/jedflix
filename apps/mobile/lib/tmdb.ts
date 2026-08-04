import { createTmdbClient } from "@jedflix/tmdb";
import Constants from "expo-constants";

const apiKey =
  process.env.EXPO_PUBLIC_TMDB_API_KEY ?? Constants.expoConfig?.extra?.tmdbApiKey ?? "";

export const tmdb = createTmdbClient({ apiKey });

export {
  getMediaDetailPath,
  getPersonPath,
  getWatchPath,
  mediaRows,
  buildHomeCatalogRows,
  buildMediaCatalogRows,
  streamingProviderRows,
} from "@jedflix/tmdb";

export type { CatalogRow, SearchResults, TvEpisode, TvSeasonSummary } from "@jedflix/tmdb";
