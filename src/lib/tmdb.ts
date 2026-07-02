import type { MediaItem, MediaType } from "@/lib/types";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const FALLBACK_POSTER =
  "https://placehold.co/500x750/18181b/a1a1aa?text=No+Poster";
const FALLBACK_BACKDROP =
  "https://placehold.co/1280x720/09090b/a1a1aa?text=No+Backdrop";

type TmdbListResponse<T> = {
  results: T[];
};

type TmdbGenre = {
  id: number;
  name: string;
};

type TmdbListItem = {
  id: number;
  media_type?: MediaType | "person";
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genre_ids?: number[];
};

type TmdbMovieDetails = TmdbListItem & {
  runtime?: number | null;
  genres?: TmdbGenre[];
};

type TmdbShowDetails = TmdbListItem & {
  episode_run_time?: number[];
  genres?: TmdbGenre[];
};

type FetchOptions = Record<string, string | number | boolean | undefined>;

export const mediaRows = {
  movie: [
    { title: "Popular Movies", genreId: undefined },
    { title: "Action Movies", genreId: 28 },
    { title: "Comedies", genreId: 35 },
    { title: "Science Fiction", genreId: 878 },
    { title: "Thrillers", genreId: 53 },
  ],
  tv: [
    { title: "Popular Shows", genreId: undefined },
    { title: "Drama Shows", genreId: 18 },
    { title: "Comedy Shows", genreId: 35 },
    { title: "Sci-Fi & Fantasy", genreId: 10765 },
    { title: "Mystery Shows", genreId: 9648 },
  ],
} as const;

export async function getTrendingMedia(): Promise<MediaItem[]> {
  const data = await tmdbFetch<TmdbListResponse<TmdbListItem>>("/trending/all/week");
  return data.results
    .map((item) => normalizeMediaItem(item))
    .filter((item): item is MediaItem => item !== null);
}

export async function discoverMedia(
  mediaType: MediaType,
  options: { genreId?: number; query?: string } = {},
): Promise<MediaItem[]> {
  if (options.query) {
    return searchMedia(options.query, mediaType);
  }

  const data = await tmdbFetch<TmdbListResponse<TmdbListItem>>(
    `/discover/${mediaType}`,
    {
      include_adult: false,
      language: "en-US",
      page: 1,
      sort_by: "popularity.desc",
      with_genres: options.genreId,
    },
  );

  return data.results
    .map((item) => normalizeMediaItem(item, mediaType))
    .filter((item): item is MediaItem => item !== null);
}

export async function searchMedia(
  query: string,
  mediaType?: MediaType,
): Promise<MediaItem[]> {
  const endpoint = mediaType ? `/search/${mediaType}` : "/search/multi";
  const data = await tmdbFetch<TmdbListResponse<TmdbListItem>>(endpoint, {
    include_adult: false,
    language: "en-US",
    page: 1,
    query,
  });

  return data.results
    .map((item) => normalizeMediaItem(item, mediaType))
    .filter((item): item is MediaItem => item !== null);
}

export async function getMediaDetails(
  mediaType: MediaType,
  id: number,
): Promise<MediaItem | null> {
  const data = await tmdbFetch<TmdbMovieDetails | TmdbShowDetails>(
    `/${mediaType}/${id}`,
    { language: "en-US" },
  );
  return normalizeMediaDetails(data, mediaType);
}

export async function getSimilarMedia(
  mediaType: MediaType,
  id: number,
): Promise<MediaItem[]> {
  const data = await tmdbFetch<TmdbListResponse<TmdbListItem>>(
    `/${mediaType}/${id}/recommendations`,
    { language: "en-US", page: 1 },
  );

  return data.results
    .map((item) => normalizeMediaItem(item, mediaType))
    .filter((item): item is MediaItem => item !== null && item.id !== id);
}

export async function getMediaDetailsByIds(
  media: Array<{ mediaType: MediaType; movieId: number }>,
): Promise<MediaItem[]> {
  const details = await Promise.all(
    media.map((item) => getMediaDetails(item.mediaType, item.movieId)),
  );
  return details.filter((item): item is MediaItem => item !== null);
}

export function getMediaDetailPath(media: Pick<MediaItem, "id" | "mediaType">) {
  return media.mediaType === "movie" ? `/movie/${media.id}` : `/show/${media.id}`;
}

export function getWatchPath(
  mediaType: MediaType,
  mediaId: number,
  season?: number,
  episode?: number,
) {
  if (mediaType === "movie") {
    return `/watch/movie/${mediaId}`;
  }
  if (season && episode) {
    return `/watch/tv/${mediaId}/${season}/${episode}`;
  }
  return `/show/${mediaId}`;
}

type ExternalIdsResponse = {
  imdb_id?: string | null;
};

export async function getExternalIds(
  mediaType: MediaType,
  tmdbId: number,
): Promise<{ imdbId: string | null }> {
  const data = await tmdbFetch<ExternalIdsResponse>(`/${mediaType}/${tmdbId}/external_ids`);
  return { imdbId: data.imdb_id ?? null };
}

export type TvSeasonSummary = {
  seasonNumber: number;
  name: string;
  episodeCount: number;
};

export type TvEpisode = {
  episodeNumber: number;
  title: string;
  overview: string;
  stillUrl: string | null;
  runtimeMinutes: number | null;
};

type TmdbSeasonListResponse = {
  seasons: Array<{
    season_number: number;
    name: string;
    episode_count: number;
  }>;
};

type TmdbSeasonDetailsResponse = {
  episodes: Array<{
    episode_number: number;
    name: string;
    overview?: string;
    still_path?: string | null;
    runtime?: number | null;
  }>;
};

export async function getTvSeasons(showId: number): Promise<TvSeasonSummary[]> {
  const data = await tmdbFetch<TmdbSeasonListResponse>(`/tv/${showId}`);
  return data.seasons
    .filter((season) => season.season_number > 0)
    .map((season) => ({
      seasonNumber: season.season_number,
      name: season.name,
      episodeCount: season.episode_count,
    }));
}

export async function getTvSeasonEpisodes(
  showId: number,
  seasonNumber: number,
): Promise<TvEpisode[]> {
  const data = await tmdbFetch<TmdbSeasonDetailsResponse>(`/tv/${showId}/season/${seasonNumber}`);
  return data.episodes.map((episode) => ({
    episodeNumber: episode.episode_number,
    title: episode.name,
    overview: episode.overview ?? "",
    stillUrl: episode.still_path
      ? `${TMDB_IMAGE_BASE}/w300${episode.still_path}`
      : null,
    runtimeMinutes: episode.runtime ?? null,
  }));
}

async function tmdbFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const apiKey = import.meta.env.VITE_TMDB_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_TMDB_API_KEY");
  }

  const url = new URL(`${TMDB_API_BASE}${path}`);
  url.searchParams.set("api_key", apiKey);

  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeMediaItem(
  item: TmdbListItem,
  fallbackMediaType?: MediaType,
): MediaItem | null {
  const mediaType = item.media_type ?? fallbackMediaType;
  if (mediaType !== "movie" && mediaType !== "tv") {
    return null;
  }

  const title = item.title ?? item.name;
  if (!title) {
    return null;
  }

  return {
    id: item.id,
    mediaType,
    title,
    description: item.overview || "No description available.",
    posterUrl: imageUrl(item.poster_path, "w500", FALLBACK_POSTER),
    backdropUrl: imageUrl(item.backdrop_path, "w1280", FALLBACK_BACKDROP),
    year: getYear(item.release_date ?? item.first_air_date),
    rating: formatVoteAverage(item.vote_average),
  };
}

function normalizeMediaDetails(
  item: TmdbMovieDetails | TmdbShowDetails,
  mediaType: MediaType,
): MediaItem | null {
  const normalized = normalizeMediaItem(item, mediaType);
  if (!normalized) {
    return null;
  }

  const runtime =
    mediaType === "movie"
      ? (item as TmdbMovieDetails).runtime
      : (item as TmdbShowDetails).episode_run_time?.[0];

  return {
    ...normalized,
    genre: item.genres?.map((genre) => genre.name).join(", "),
    durationMinutes: runtime || undefined,
  };
}

function imageUrl(
  path: string | null | undefined,
  size: "w500" | "w1280",
  fallback: string,
) {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : fallback;
}

function getYear(date: string | undefined): number | null {
  if (!date) {
    return null;
  }
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function formatVoteAverage(voteAverage: number | undefined): string {
  if (voteAverage === undefined || voteAverage === 0) {
    return "Not rated";
  }
  return `${voteAverage.toFixed(1)} TMDB`;
}
