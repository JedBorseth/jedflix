import type {
  CastMember,
  FilmographyItem,
  MediaItem,
  MediaType,
  PersonDetails,
  PersonSummary,
} from "@jedflix/shared";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const FALLBACK_POSTER =
  "https://placehold.co/500x750/18181b/a1a1aa?text=No+Poster";
const FALLBACK_BACKDROP =
  "https://placehold.co/1280x720/09090b/a1a1aa?text=No+Backdrop";
const FALLBACK_PROFILE =
  "https://placehold.co/300x450/18181b/a1a1aa?text=No+Photo";
const MAX_CAST_SIZE = 20;
const KNOWN_FOR_LIMIT = 12;

type FilmographyCredit = FilmographyItem & {
  popularity: number;
};

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
  profile_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genre_ids?: number[];
  known_for?: TmdbListItem[];
};

type TmdbCastMember = {
  id: number;
  name: string;
  character?: string;
  profile_path?: string | null;
};

type TmdbCreditsResponse = {
  cast: TmdbCastMember[];
};

type TmdbPersonDetails = {
  id: number;
  name: string;
  biography?: string;
  birthday?: string | null;
  profile_path?: string | null;
};

type TmdbCombinedCredit = {
  id: number;
  media_type?: MediaType;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
  character?: string;
};

type TmdbCombinedCreditsResponse = {
  cast: TmdbCombinedCredit[];
};

export type SearchResults = {
  media: MediaItem[];
  people: PersonSummary[];
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

export type TmdbClientConfig = {
  apiKey: string;
};

export type TmdbClient = {
  getTrendingMedia: typeof getTrendingMedia;
  discoverMedia: typeof discoverMedia;
  searchMedia: typeof searchMedia;
  searchAll: typeof searchAll;
  getMediaCredits: typeof getMediaCredits;
  getPersonDetails: typeof getPersonDetails;
  getMediaDetails: typeof getMediaDetails;
  getSimilarMedia: typeof getSimilarMedia;
  getMediaDetailsByIds: typeof getMediaDetailsByIds;
  getExternalIds: typeof getExternalIds;
  getTvSeasons: typeof getTvSeasons;
  getTvSeasonEpisodes: typeof getTvSeasonEpisodes;
};

let configuredApiKey = "";

export function configureTmdb(config: TmdbClientConfig) {
  configuredApiKey = config.apiKey;
}

export function createTmdbClient(config: TmdbClientConfig): TmdbClient {
  configureTmdb(config);
  return {
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
  };
}

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

export async function searchAll(query: string): Promise<SearchResults> {
  const data = await tmdbFetch<TmdbListResponse<TmdbListItem>>("/search/multi", {
    include_adult: false,
    language: "en-US",
    page: 1,
    query,
  });

  const media: MediaItem[] = [];
  const people: PersonSummary[] = [];

  for (const item of data.results) {
    if (item.media_type === "person") {
      const person = normalizePersonSummary(item);
      if (person) {
        people.push(person);
      }
      continue;
    }

    const normalized = normalizeMediaItem(item);
    if (normalized) {
      media.push(normalized);
    }
  }

  return { media, people };
}

export async function getMediaCredits(
  mediaType: MediaType,
  id: number,
): Promise<CastMember[]> {
  const endpoint =
    mediaType === "movie"
      ? `/movie/${id}/credits`
      : `/tv/${id}/aggregate_credits`;

  const data = await tmdbFetch<TmdbCreditsResponse>(endpoint, { language: "en-US" });

  return data.cast.slice(0, MAX_CAST_SIZE).map((member) => ({
    id: member.id,
    name: member.name,
    character: member.character ?? "Unknown role",
    profileUrl: profileUrl(member.profile_path),
  }));
}

export async function getPersonDetails(id: number): Promise<PersonDetails | null> {
  const [person, creditsResponse] = await Promise.all([
    tmdbFetch<TmdbPersonDetails>(`/person/${id}`, { language: "en-US" }),
    tmdbFetch<TmdbCombinedCreditsResponse>(`/person/${id}/combined_credits`, {
      language: "en-US",
    }),
  ]);

  if (!person.name) {
    return null;
  }

  const credits = dedupeFilmographyCredits(
    creditsResponse.cast
      .map((credit) => normalizeFilmographyCredit(credit))
      .filter((item): item is FilmographyCredit => item !== null),
  );

  const filmography = [...credits]
    .sort((left, right) => (right.year ?? 0) - (left.year ?? 0))
    .map(stripFilmographyPopularity);

  return {
    id: person.id,
    name: person.name,
    profileUrl: profileUrl(person.profile_path),
    biography: person.biography?.trim() || "No biography available.",
    birthday: person.birthday ?? null,
    knownFor: pickKnownFor(credits, person.biography?.trim() || ""),
    filmography,
  };
}

export function getPersonPath(id: number) {
  return `/person/${id}`;
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
  if (!configuredApiKey) {
    throw new Error("Missing TMDB API key");
  }

  const url = new URL(`${TMDB_API_BASE}${path}`);
  url.searchParams.set("api_key", configuredApiKey);

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
    releaseDate: item.release_date ?? item.first_air_date ?? null,
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

function profileUrl(path: string | null | undefined) {
  return path ? `${TMDB_IMAGE_BASE}/w500${path}` : FALLBACK_PROFILE;
}

function normalizePersonSummary(item: TmdbListItem): PersonSummary | null {
  if (!item.name) {
    return null;
  }

  const knownForTitles = item.known_for
    ?.map((credit) => credit.title ?? credit.name)
    .filter((title): title is string => Boolean(title))
    .slice(0, 3);

  return {
    id: item.id,
    name: item.name,
    profileUrl: profileUrl(item.profile_path),
    knownFor: knownForTitles?.length ? knownForTitles.join(", ") : undefined,
  };
}

function normalizeFilmographyCredit(credit: TmdbCombinedCredit): FilmographyCredit | null {
  const normalized = normalizeMediaItem(credit);
  if (!normalized || !credit.poster_path) {
    return null;
  }

  return {
    ...normalized,
    character: credit.character || undefined,
    popularity: credit.popularity ?? 0,
  };
}

function pickKnownFor(items: FilmographyCredit[], biography: string): FilmographyItem[] {
  const highlighted = findBiographyHighlightedCredits(items, biography);
  const highlightedKeys = new Set(
    highlighted.map((item) => `${item.mediaType}-${item.id}`),
  );

  const remaining = [...items]
    .filter((item) => !highlightedKeys.has(`${item.mediaType}-${item.id}`))
    .sort((left, right) => right.popularity - left.popularity);

  return [...highlighted, ...remaining]
    .slice(0, KNOWN_FOR_LIMIT)
    .map(stripFilmographyPopularity);
}

function findBiographyHighlightedCredits(
  items: FilmographyCredit[],
  biography: string,
): FilmographyCredit[] {
  if (!biography) {
    return [];
  }

  const highlighted: Array<{ item: FilmographyCredit; index: number }> = [];

  for (const item of items) {
    const matchIndex = findBiographyTitleMention(biography, item);
    if (matchIndex >= 0) {
      highlighted.push({ item, index: matchIndex });
    }
  }

  highlighted.sort((left, right) => left.index - right.index);

  const seen = new Set<string>();
  const results: FilmographyCredit[] = [];
  for (const { item } of highlighted) {
    const key = `${item.mediaType}-${item.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(item);
    }
  }

  return results;
}

function findBiographyTitleMention(biography: string, item: FilmographyCredit): number {
  const titlePattern = escapeRegExp(item.title);

  if (item.year !== null) {
    const exactYearPattern = new RegExp(
      `${titlePattern}\\s\\(${item.year}(?:[–\\-][^)]*)?\\)`,
      "i",
    );
    const exactYearMatch = exactYearPattern.exec(biography);
    if (exactYearMatch) {
      return exactYearMatch.index;
    }
  }

  const titleYearPattern = new RegExp(`${titlePattern}\\s\\((\\d{4})`, "i");
  const titleYearMatch = titleYearPattern.exec(biography);
  if (!titleYearMatch) {
    return -1;
  }

  const mentionYear = Number(titleYearMatch[1]);
  if (
    item.year !== null &&
    item.year !== mentionYear &&
    Math.abs(item.year - mentionYear) > 1
  ) {
    return -1;
  }

  return titleYearMatch.index;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeFilmographyCredits(items: FilmographyCredit[]): FilmographyCredit[] {
  const bestByKey = new Map<string, FilmographyCredit>();

  for (const item of items) {
    const key = `${item.mediaType}-${item.id}`;
    const existing = bestByKey.get(key);
    if (!existing || item.popularity > existing.popularity) {
      bestByKey.set(key, item);
    }
  }

  return [...bestByKey.values()];
}

function stripFilmographyPopularity({
  popularity: _popularity,
  ...item
}: FilmographyCredit): FilmographyItem {
  return item;
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
