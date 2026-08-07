import { createTmdbClient } from "@jedflix/tmdb";
import Constants from "expo-constants";

const backendBaseUrl =
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  process.env.EXPO_PUBLIC_STREAM_API_URL ??
  Constants.expoConfig?.extra?.backendUrl ??
  Constants.expoConfig?.extra?.streamApiUrl ??
  "/backend";

export const tmdb = createTmdbClient({ backendBaseUrl });

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
