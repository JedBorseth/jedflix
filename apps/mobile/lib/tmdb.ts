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
} from "@jedflix/tmdb";

export type { SearchResults, TvEpisode, TvSeasonSummary } from "@jedflix/tmdb";
