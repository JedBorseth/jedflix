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
  resolveStream: (
    source: StreamSource,
    request: ResolveRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<StreamResult>;
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

  async function resolveStream(
    source: StreamSource,
    request: ResolveRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<StreamResult> {
    const token = request.realDebridToken?.trim() ?? "";
    if (!token) {
      throw new StreamResolveError(
        "missing_token",
        "Real Debrid API key is required for direct streaming.",
      );
    }

    const response = await fetch(`${apiBase}/api/v1/resolve`, {
      method: "POST",
      headers: headers(token),
      signal: options.signal,
      body: JSON.stringify({
        type: request.type,
        magnet: source.magnet,
        infoHash: source.infoHash ?? request.infoHash,
        title: source.title,
        season: request.season,
        episode: request.episode,
        playbackProfile: request.playbackProfile ?? "browser",
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      const code = payload?.code;
      const message = payload?.error ?? `Stream resolve failed (${response.status})`;
      if (code) {
        throw new StreamResolveError(code, message, response.status);
      }
      throw new Error(message);
    }

    return (await response.json()) as StreamResult;
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
    resolveStream,
    fetchLetterboxdFilmsByDate,
    verifyLetterboxdUsername,
  };
}

export class StreamResolveError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "StreamResolveError";
    this.code = code;
    this.status = status;
  }
}
