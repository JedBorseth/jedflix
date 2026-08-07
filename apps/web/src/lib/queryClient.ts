import { QueryClient } from "@tanstack/react-query";

/**
 * Client cache for external HTTP catalogs (TMDB, Open Library, Letterboxd, Spotify).
 * Convex realtime data stays on convex/react useQuery.
 *
 * staleTime: Infinity ≈ once per browser session unless explicitly invalidated.
 */
export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: 1000 * 60 * 60 * 6,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });
}

export const queryClient = createAppQueryClient();

export const catalogQueryKeys = {
  tmdb: {
    all: ["tmdb"] as const,
    trending: () => ["tmdb", "trending"] as const,
    discover: (
      mediaType: string,
      options: { genreId?: number; watchProviderId?: number } = {},
    ) =>
      [
        "tmdb",
        "discover",
        mediaType,
        options.genreId ?? null,
        options.watchProviderId ?? null,
      ] as const,
    details: (mediaType: string, id: number) =>
      ["tmdb", "details", mediaType, id] as const,
    detailsByIds: (ids: Array<{ mediaType: string; movieId: number }>) =>
      [
        "tmdb",
        "detailsByIds",
        ids.map((item) => `${item.mediaType}:${item.movieId}`).join(","),
      ] as const,
    similar: (mediaType: string, id: number) =>
      ["tmdb", "similar", mediaType, id] as const,
    credits: (mediaType: string, id: number) =>
      ["tmdb", "credits", mediaType, id] as const,
    person: (id: number) => ["tmdb", "person", id] as const,
    search: (query: string) => ["tmdb", "search", query] as const,
    seasons: (showId: number) => ["tmdb", "seasons", showId] as const,
    episodes: (showId: number, seasonNumber: number) =>
      ["tmdb", "episodes", showId, seasonNumber] as const,
  },
  openLibrary: {
    all: ["openLibrary"] as const,
    browse: () => ["openLibrary", "browse"] as const,
    work: (workId: string) => ["openLibrary", "work", workId] as const,
    author: (authorId: string) => ["openLibrary", "author", authorId] as const,
    search: (query: string) => ["openLibrary", "search", query] as const,
    relatedByAuthor: (author: string, excludeWorkId: string) =>
      ["openLibrary", "related", author, excludeWorkId] as const,
  },
  letterboxd: {
    films: (username: string) => ["letterboxd", "films", username] as const,
  },
  spotify: {
    all: ["spotify"] as const,
    browse: () => ["spotify", "browse"] as const,
    album: (albumId: string, name = "", artist = "") =>
      ["spotify", "album", "v2", albumId, name, artist] as const,
    artist: (artistId: string, name = "") =>
      ["spotify", "artist", "v3", artistId, name] as const,
    artistAlbums: (artistId: string, name = "") =>
      ["spotify", "artist-albums", "v1", artistId, name] as const,
    search: (query: string, includeYoutube = false) =>
      ["spotify", "search", query, includeYoutube ? "yt" : "spotify"] as const,
  },
  lastfm: {
    all: ["lastfm"] as const,
    similarArtists: (artist: string) =>
      ["lastfm", "similar-artists", artist] as const,
    related: (key: string) => ["lastfm", "related", key] as const,
  },
} as const;
