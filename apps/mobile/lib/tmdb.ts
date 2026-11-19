import { createTmdbClient } from "@jedflix/tmdb";
import { backendBaseUrl } from "./stream";

export const tmdb = createTmdbClient({ backendBaseUrl });

export { buildHomeCatalogRows } from "@jedflix/tmdb";
