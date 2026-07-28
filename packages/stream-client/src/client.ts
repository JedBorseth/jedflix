import type { PlaybackProfile } from "@jedflix/shared";

export type SourcesRequest = {
  type: "movie" | "tv";
  imdbId: string;
  season?: number;
  episode?: number;
  playbackProfile?: PlaybackProfile;
};

export type ResolveRequest = SourcesRequest & {
  magnet?: string;
  infoHash?: string;
  realDebridToken?: string;
};

export type StreamSource = {
  id: string;
  title: string;
  magnet: string;
  infoHash?: string;
  sizeGb?: number;
  seeders?: number;
  cached?: boolean;
};

export type StreamResult = {
  url: string;
  directUrl?: string;
  filename?: string;
  filesize?: number;
  mode: "direct";
};

export type LetterboxdFilm = {
  slug: string;
  title: string;
  year?: number;
  posterUrl?: string;
  watchedDate?: string;
  tmdbId?: number;
  rating?: number;
  link?: string;
};

export type LetterboxdFilmsResponse = {
  user: string;
  displayName?: string;
  films: LetterboxdFilm[];
  cachedAt: number;
  source: string;
};

export type LetterboxdVerifyResponse = {
  valid: boolean;
  username: string;
  displayName?: string;
  filmCount: number;
  films?: LetterboxdFilm[];
  cachedAt: number;
  error?: string;
};

export type StreamClientConfig = {
  apiBase: string;
  apiKey?: string;
};

export type StreamClient = {
  resolveStreamUrl: (relativeOrAbsolute: string) => string;
  getPlaybackUrl: (stream: StreamResult) => string;
  getExternalPlaybackUrl: (stream: StreamResult) => string;
  fetchSources: (request: SourcesRequest, realDebridToken?: string) => Promise<StreamSource[]>;
  fetchLetterboxdFilmsByDate: (username: string) => Promise<LetterboxdFilmsResponse>;
  verifyLetterboxdUsername: (username: string) => Promise<LetterboxdVerifyResponse>;
};

/** JSON contract mirrors apps/stream-server/internal/resolver/resolver.go */
export function createStreamClient(config: StreamClientConfig): StreamClient {
  const apiBase = config.apiBase.replace(/\/$/, "");
  const apiKey = config.apiKey;

  function headers(realDebridToken?: string): HeadersInit {
    const result: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      result["X-Api-Key"] = apiKey;
    }
    if (realDebridToken) {
      result.Authorization = `Bearer ${realDebridToken}`;
    }
    return result;
  }

  function resolveStreamUrl(relativeOrAbsolute: string): string {
    if (relativeOrAbsolute.startsWith("http://") || relativeOrAbsolute.startsWith("https://")) {
      return relativeOrAbsolute;
    }
    if (relativeOrAbsolute.startsWith(`${apiBase}/`) || relativeOrAbsolute === apiBase) {
      return relativeOrAbsolute;
    }
    return `${apiBase}${relativeOrAbsolute.startsWith("/") ? "" : "/"}${relativeOrAbsolute}`;
  }

  function getPlaybackUrl(stream: StreamResult): string {
    return stream.directUrl ?? stream.url;
  }

  function getExternalPlaybackUrl(stream: StreamResult): string {
    return stream.directUrl ?? getPlaybackUrl(stream);
  }

  async function fetchSources(
    request: SourcesRequest,
    realDebridToken?: string,
  ): Promise<StreamSource[]> {
    const response = await fetch(`${apiBase}/api/v1/sources`, {
      method: "POST",
      headers: headers(realDebridToken),
      body: JSON.stringify({
        ...request,
        playbackProfile: request.playbackProfile ?? "browser",
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Source search failed (${response.status})`);
    }
    const payload = (await response.json()) as { sources: StreamSource[] };
    return payload.sources;
  }

  async function fetchLetterboxdFilmsByDate(username: string): Promise<LetterboxdFilmsResponse> {
    const encoded = encodeURIComponent(username.trim());
    const response = await fetch(`${apiBase}/api/v1/letterboxd/${encoded}/films/by/date`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Letterboxd fetch failed (${response.status})`);
    }
    return (await response.json()) as LetterboxdFilmsResponse;
  }

  async function verifyLetterboxdUsername(username: string): Promise<LetterboxdVerifyResponse> {
    const encoded = encodeURIComponent(username.trim());
    const response = await fetch(`${apiBase}/api/v1/letterboxd/${encoded}/verify`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | LetterboxdVerifyResponse
        | { error?: string }
        | null;
      if (payload && "valid" in payload) {
        return payload;
      }
      throw new Error(
        (payload && "error" in payload && payload.error) ||
          `Letterboxd verification failed (${response.status})`,
      );
    }
    return (await response.json()) as LetterboxdVerifyResponse;
  }

  return {
    resolveStreamUrl,
    getPlaybackUrl,
    getExternalPlaybackUrl,
    fetchSources,
    fetchLetterboxdFilmsByDate,
    verifyLetterboxdUsername,
  };
}
