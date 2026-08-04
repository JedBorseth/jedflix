import type { PlaybackProfile } from "@jedflix/shared";

export type VideoSourcesRequest = {
  type: "movie" | "tv";
  imdbId: string;
  season?: number;
  episode?: number;
  playbackProfile?: PlaybackProfile;
};

export type BookSourcesRequest = {
  type: "audiobook" | "ebook";
  title: string;
  author?: string;
  query?: string;
  playbackProfile?: PlaybackProfile;
};

export type SourcesRequest = VideoSourcesRequest | BookSourcesRequest;

export type StreamSource = {
  id: string;
  title: string;
  magnet: string;
  infoHash?: string;
  fileIdx?: number;
  sizeGb?: number;
  seeders?: number;
  cached?: boolean;
  abbPostUrl?: string;
  info?: string;
  matchScore?: number;
};

export type ResolveRequest = {
  type: SourcesRequest["type"];
  imdbId?: string;
  season?: number;
  episode?: number;
  title?: string;
  author?: string;
  query?: string;
  magnet?: string;
  abbPostUrl?: string;
  infoHash?: string;
  mediaTitle?: string;
  fileIdx?: number;
  playbackProfile?: PlaybackProfile;
  realDebridToken?: string;
};

export type StreamFile = {
  index: number;
  fileId: number;
  filename: string;
  url: string;
  filesize: number;
  mimeType?: string;
};

export type PackKind = "single" | "chapters" | "series";

export type StreamResult = {
  url: string;
  directUrl?: string;
  filename?: string;
  filesize?: number;
  mode: "direct";
  files?: StreamFile[];
  packKind?: PackKind;
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

export type OpenLibraryBook = {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  /** Full-resolution Open Library cover; upgrade from coverUrl when loaded. */
  coverFullUrl?: string;
  authors: string[];
  authorKeys: string[];
  year: number | null;
  pageCount: number | null;
  subjects: string[];
};

export type OpenLibraryAuthorSummary = {
  id: string;
  name: string;
  photoUrl: string;
  /** Full-resolution Open Library photo; upgrade from photoUrl when loaded. */
  photoFullUrl?: string;
  topWork?: string;
  workCount?: number;
};

export type OpenLibraryAuthorDetails = OpenLibraryAuthorSummary & {
  biography: string;
  birthDate?: string;
  works: OpenLibraryBook[];
};

export type OpenLibrarySubjectRow = {
  title: string;
  subject: string;
  books: OpenLibraryBook[];
};

export type OpenLibraryBrowseResponse = {
  trending: OpenLibraryBook[];
  rows: OpenLibrarySubjectRow[];
  cachedAt: number;
};

export type OpenLibrarySearchResponse = {
  books: OpenLibraryBook[];
  authors: OpenLibraryAuthorSummary[];
};

export type SpotifyTrack = {
  id: string;
  name: string;
  artists: string[];
  artistIds?: string[];
  trackNumber: number;
  discNumber: number;
  durationMs: number;
  explicit: boolean;
};

export type SpotifyTopTrack = SpotifyTrack & {
  albumId: string;
  albumName: string;
  imageUrl: string;
};

export type SpotifyAlbum = {
  id: string;
  name: string;
  artists: string[];
  artistIds: string[];
  imageUrl: string;
  releaseDate?: string;
  year: number | null;
  albumType?: string;
  totalTracks?: number;
  label?: string;
  genres: string[];
  popularity?: number;
  tracks?: SpotifyTrack[];
};

export type SpotifyArtist = {
  id: string;
  name: string;
  imageUrl: string;
  genres: string[];
  followers?: number;
  popularity?: number;
};

export type SpotifyArtistDetails = SpotifyArtist & {
  topTracks: SpotifyTopTrack[];
  albums: SpotifyAlbum[];
  discography: SpotifyAlbum[];
};

export type SpotifyCatalogRow = {
  title: string;
  key: string;
  kind: "albums" | "artists";
  albums?: SpotifyAlbum[];
  artists?: SpotifyArtist[];
};

export type SpotifyBrowseResponse = {
  newReleases: SpotifyAlbum[];
  rows: SpotifyCatalogRow[];
  cachedAt: number;
};

export type SpotifySearchResponse = {
  albums: SpotifyAlbum[];
  artists: SpotifyArtist[];
};

export type StreamClientConfig = {
  apiBase: string;
  apiKey?: string;
};

export type YoutubeAudioResolveResult = {
  videoId: string;
  title: string;
  contentType: string;
  ext: string;
};

export type StreamClient = {
  resolveStreamUrl: (relativeOrAbsolute: string) => string;
  getPlaybackUrl: (stream: StreamResult) => string;
  getExternalPlaybackUrl: (stream: StreamResult) => string;
  fetchSources: (request: SourcesRequest, realDebridToken?: string) => Promise<StreamSource[]>;
  resolveStream: (
    source: StreamSource,
    request: ResolveRequest,
    options?: { signal?: AbortSignal; onProgress?: (progress: string) => void },
  ) => Promise<StreamResult>;
  fetchLetterboxdFilmsByDate: (username: string) => Promise<LetterboxdFilmsResponse>;
  verifyLetterboxdUsername: (username: string) => Promise<LetterboxdVerifyResponse>;
  fetchOpenLibraryBrowse: () => Promise<OpenLibraryBrowseResponse>;
  searchOpenLibrary: (query: string) => Promise<OpenLibrarySearchResponse>;
  fetchOpenLibraryWork: (workId: string) => Promise<OpenLibraryBook>;
  fetchOpenLibraryAuthor: (authorId: string) => Promise<OpenLibraryAuthorDetails>;
  fetchSpotifyBrowse: () => Promise<SpotifyBrowseResponse>;
  searchSpotify: (query: string) => Promise<SpotifySearchResponse>;
  fetchSpotifyAlbum: (albumId: string) => Promise<SpotifyAlbum>;
  fetchSpotifyArtist: (artistId: string) => Promise<SpotifyArtistDetails>;
  getYoutubeAudioUrl: (params: {
    artist?: string;
    title?: string;
    album?: string;
    durationMs?: number;
    /** When set, stream-server skips yt-dlp search and extracts this video. */
    videoId?: string;
  }) => string;
  /** Resolve Spotify→YouTube metadata without streaming audio (for party sharing). */
  resolveYoutubeAudio: (params: {
    artist?: string;
    title?: string;
    album?: string;
    durationMs?: number;
    videoId?: string;
    signal?: AbortSignal;
  }) => Promise<YoutubeAudioResolveResult>;
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
    return (payload.sources ?? []).map(normalizeSource);
  }

  async function resolveStream(
    source: StreamSource,
    request: ResolveRequest,
    options: { signal?: AbortSignal; onProgress?: (progress: string) => void } = {},
  ): Promise<StreamResult> {
    const token = request.realDebridToken?.trim() ?? "";
    if (!token) {
      throw new StreamResolveError(
        "missing_token",
        "Real Debrid API key is required for direct streaming.",
      );
    }

    const body = JSON.stringify({
      type: request.type,
      magnet: source.magnet || request.magnet,
      abbPostUrl: source.abbPostUrl || request.abbPostUrl,
      infoHash: source.infoHash ?? request.infoHash,
      title: source.title,
      mediaTitle: request.mediaTitle,
      fileIdx: source.fileIdx ?? request.fileIdx,
      season: request.season,
      episode: request.episode,
      playbackProfile: request.playbackProfile ?? "browser",
    });

    options.onProgress?.("Starting resolve job…");
    const startResponse = await fetch(`${apiBase}/api/v1/resolve`, {
      method: "POST",
      headers: headers(token),
      signal: options.signal,
      credentials: "same-origin",
      body,
    });

    // Legacy sync servers still return 200 with the stream payload.
    if (startResponse.ok && startResponse.status === 200) {
      return normalizeStreamResult((await startResponse.json()) as StreamResult);
    }

    if (startResponse.status !== 202 && !startResponse.ok) {
      const payload = (await startResponse.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      const code = payload?.code;
      const message = payload?.error ?? `Stream resolve failed (${startResponse.status})`;
      if (code) {
        throw new StreamResolveError(code, message, startResponse.status);
      }
      throw new Error(message);
    }

    const started = (await startResponse.json()) as {
      jobId?: string;
      status?: string;
      progress?: string;
      result?: StreamResult;
      error?: string;
      code?: string;
    };

    if (started.result && started.status === "ready") {
      return normalizeStreamResult(started.result);
    }

    const jobId = started.jobId?.trim();
    if (!jobId) {
      throw new Error("Stream resolve did not return a job id.");
    }

    if (started.progress) {
      options.onProgress?.(started.progress);
    }

    const startedAt = Date.now();
    const maxWaitMs = 12 * 60 * 1000;

    while (true) {
      if (options.signal?.aborted) {
        throw new DOMException("Real Debrid resolve was cancelled.", "AbortError");
      }
      if (Date.now() - startedAt > maxWaitMs) {
        throw new StreamResolveError(
          "timeout",
          "Timed out waiting for the stream-server resolve job. Check Real Debrid or try another source.",
        );
      }

      await sleep(1500, options.signal);

      const pollResponse = await fetch(`${apiBase}/api/v1/resolve/jobs/${encodeURIComponent(jobId)}`, {
        headers: headers(token),
        signal: options.signal,
        credentials: "same-origin",
      });

      if (!pollResponse.ok) {
        const payload = (await pollResponse.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        const code = payload?.code;
        const message = payload?.error ?? `Resolve job poll failed (${pollResponse.status})`;
        if (code) {
          throw new StreamResolveError(code, message, pollResponse.status);
        }
        throw new Error(message);
      }

      const job = (await pollResponse.json()) as {
        status?: string;
        progress?: string;
        result?: StreamResult;
        error?: string;
        code?: string;
      };

      if (job.progress) {
        options.onProgress?.(job.progress);
      }

      if (job.status === "ready" && job.result) {
        return normalizeStreamResult(job.result);
      }
      if (job.status === "failed") {
        const message = job.error ?? "Stream resolve failed.";
        if (job.code) {
          throw new StreamResolveError(job.code, message);
        }
        throw new Error(message);
      }
    }
  }

  function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Real Debrid resolve was cancelled.", "AbortError"));
        return;
      }
      const timer = globalThis.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        globalThis.clearTimeout(timer);
        reject(new DOMException("Real Debrid resolve was cancelled.", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
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

  async function fetchOpenLibraryBrowse(): Promise<OpenLibraryBrowseResponse> {
    const response = await fetch(`${apiBase}/api/v1/openlibrary/browse`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Open Library browse failed (${response.status})`);
    }
    return normalizeBrowseResponse(await response.json());
  }

  async function searchOpenLibrary(query: string): Promise<OpenLibrarySearchResponse> {
    const params = new URLSearchParams({ q: query.trim() });
    const response = await fetch(`${apiBase}/api/v1/openlibrary/search?${params.toString()}`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Open Library search failed (${response.status})`);
    }
    const payload = (await response.json()) as OpenLibrarySearchResponse;
    return {
      books: (payload.books ?? []).map(normalizeBook),
      authors: payload.authors ?? [],
    };
  }

  async function fetchOpenLibraryWork(workId: string): Promise<OpenLibraryBook> {
    const encoded = encodeURIComponent(workId.trim());
    const response = await fetch(`${apiBase}/api/v1/openlibrary/works/${encoded}`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Open Library work failed (${response.status})`);
    }
    return normalizeBook(await response.json());
  }

  async function fetchOpenLibraryAuthor(authorId: string): Promise<OpenLibraryAuthorDetails> {
    const encoded = encodeURIComponent(authorId.trim());
    const response = await fetch(`${apiBase}/api/v1/openlibrary/authors/${encoded}`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Open Library author failed (${response.status})`);
    }
    const payload = (await response.json()) as OpenLibraryAuthorDetails;
    return {
      ...payload,
      works: (payload.works ?? []).map(normalizeBook),
    };
  }

  async function fetchSpotifyBrowse(): Promise<SpotifyBrowseResponse> {
    const response = await fetch(`${apiBase}/api/v1/spotify/browse`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Spotify browse failed (${response.status})`);
    }
    return normalizeSpotifyBrowseResponse(await response.json());
  }

  async function searchSpotify(query: string): Promise<SpotifySearchResponse> {
    const params = new URLSearchParams({ q: query.trim() });
    const response = await fetch(`${apiBase}/api/v1/spotify/search?${params.toString()}`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Spotify search failed (${response.status})`);
    }
    const payload = (await response.json()) as SpotifySearchResponse;
    return {
      albums: (payload.albums ?? []).map(normalizeSpotifyAlbum),
      artists: (payload.artists ?? []).map(normalizeSpotifyArtist),
    };
  }

  async function fetchSpotifyAlbum(albumId: string): Promise<SpotifyAlbum> {
    const encoded = encodeURIComponent(albumId.trim());
    const response = await fetch(`${apiBase}/api/v1/spotify/albums/${encoded}`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Spotify album failed (${response.status})`);
    }
    return normalizeSpotifyAlbum(await response.json());
  }

  async function fetchSpotifyArtist(artistId: string): Promise<SpotifyArtistDetails> {
    const encoded = encodeURIComponent(artistId.trim());
    const response = await fetch(`${apiBase}/api/v1/spotify/artists/${encoded}`, {
      headers: headers(),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Spotify artist failed (${response.status})`);
    }
    const payload = (await response.json()) as SpotifyArtistDetails;
    return {
      ...normalizeSpotifyArtist(payload),
      topTracks: (payload.topTracks ?? []).map(normalizeSpotifyTopTrack),
      albums: (payload.albums ?? []).map(normalizeSpotifyAlbum),
      discography: (payload.discography ?? []).map(normalizeSpotifyAlbum),
    };
  }

  function getYoutubeAudioUrl(params: {
    artist?: string;
    title?: string;
    album?: string;
    durationMs?: number;
    videoId?: string;
  }): string {
    const query = new URLSearchParams();
    const videoId = params.videoId?.trim();
    if (videoId) {
      query.set("videoId", videoId);
    } else {
      query.set("artist", (params.artist ?? "").trim());
      query.set("title", (params.title ?? "").trim());
      if (params.album?.trim()) {
        query.set("album", params.album.trim());
      }
      if (params.durationMs && Number.isFinite(params.durationMs) && params.durationMs > 0) {
        query.set("durationMs", String(Math.round(params.durationMs)));
      }
    }
    if (apiKey) {
      query.set("apikey", apiKey);
    }
    return `${apiBase}/api/v1/youtube/audio?${query.toString()}`;
  }

  async function resolveYoutubeAudio(params: {
    artist?: string;
    title?: string;
    album?: string;
    durationMs?: number;
    videoId?: string;
    signal?: AbortSignal;
  }): Promise<YoutubeAudioResolveResult> {
    const query = new URLSearchParams();
    const videoId = params.videoId?.trim();
    if (videoId) {
      query.set("videoId", videoId);
    } else {
      query.set("artist", (params.artist ?? "").trim());
      query.set("title", (params.title ?? "").trim());
      if (params.album?.trim()) {
        query.set("album", params.album.trim());
      }
      if (params.durationMs && Number.isFinite(params.durationMs) && params.durationMs > 0) {
        query.set("durationMs", String(Math.round(params.durationMs)));
      }
    }
    if (apiKey) {
      query.set("apikey", apiKey);
    }
    const response = await fetch(`${apiBase}/api/v1/youtube/resolve?${query.toString()}`, {
      headers: headers(),
      signal: params.signal,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `YouTube resolve failed (${response.status})`);
    }
    const payload = (await response.json()) as Partial<YoutubeAudioResolveResult>;
    if (!payload.videoId) {
      throw new Error("YouTube resolve did not return a video id.");
    }
    return {
      videoId: payload.videoId,
      title: payload.title ?? "",
      contentType: payload.contentType ?? "",
      ext: payload.ext ?? "",
    };
  }

  return {
    resolveStreamUrl,
    getPlaybackUrl,
    getExternalPlaybackUrl,
    fetchSources,
    resolveStream,
    fetchLetterboxdFilmsByDate,
    verifyLetterboxdUsername,
    fetchOpenLibraryBrowse,
    searchOpenLibrary,
    fetchOpenLibraryWork,
    fetchOpenLibraryAuthor,
    fetchSpotifyBrowse,
    searchSpotify,
    fetchSpotifyAlbum,
    fetchSpotifyArtist,
    getYoutubeAudioUrl,
    resolveYoutubeAudio,
  };
}

function normalizeSource(source: StreamSource): StreamSource {
  return {
    ...source,
    magnet: source.magnet ?? "",
    abbPostUrl: source.abbPostUrl,
    info: source.info,
    matchScore: source.matchScore,
  };
}

function normalizeStreamResult(result: StreamResult): StreamResult {
  const files =
    result.files && result.files.length > 0
      ? result.files
      : [
          {
            index: 0,
            fileId: 0,
            filename: result.filename ?? "stream",
            url: result.directUrl ?? result.url,
            filesize: result.filesize ?? 0,
          },
        ];
  return {
    ...result,
    files,
    packKind: result.packKind ?? (files.length > 1 ? "chapters" : "single"),
  };
}

function normalizeBrowseResponse(payload: OpenLibraryBrowseResponse): OpenLibraryBrowseResponse {
  return {
    trending: (payload.trending ?? []).map(normalizeBook),
    rows: (payload.rows ?? []).map((row) => ({
      ...row,
      books: (row.books ?? []).map(normalizeBook),
    })),
    cachedAt: payload.cachedAt,
  };
}

function normalizeBook(book: OpenLibraryBook): OpenLibraryBook {
  return {
    ...book,
    authors: book.authors ?? [],
    authorKeys: book.authorKeys ?? [],
    subjects: book.subjects ?? [],
    year: book.year ?? null,
    pageCount: book.pageCount ?? null,
  };
}

function normalizeSpotifyBrowseResponse(payload: SpotifyBrowseResponse): SpotifyBrowseResponse {
  return {
    newReleases: (payload.newReleases ?? []).map(normalizeSpotifyAlbum),
    rows: (payload.rows ?? []).map((row) => ({
      ...row,
      kind: row.kind === "artists" ? "artists" : "albums",
      albums: (row.albums ?? []).map(normalizeSpotifyAlbum),
      artists: (row.artists ?? []).map(normalizeSpotifyArtist),
    })),
    cachedAt: payload.cachedAt,
  };
}

function normalizeSpotifyAlbum(album: SpotifyAlbum): SpotifyAlbum {
  return {
    ...album,
    artists: album.artists ?? [],
    artistIds: album.artistIds ?? [],
    genres: album.genres ?? [],
    year: album.year ?? null,
    tracks: (album.tracks ?? []).map(normalizeSpotifyTrack),
  };
}

function normalizeSpotifyTrack(track: SpotifyTrack): SpotifyTrack {
  return {
    ...track,
    artists: track.artists ?? [],
    artistIds: track.artistIds ?? [],
    trackNumber: track.trackNumber ?? 0,
    discNumber: track.discNumber ?? 1,
    durationMs: track.durationMs ?? 0,
    explicit: Boolean(track.explicit),
  };
}

function normalizeSpotifyTopTrack(track: SpotifyTopTrack): SpotifyTopTrack {
  return {
    ...normalizeSpotifyTrack(track),
    albumId: track.albumId ?? "",
    albumName: track.albumName ?? "",
    imageUrl: track.imageUrl ?? "",
  };
}

function normalizeSpotifyArtist(artist: SpotifyArtist): SpotifyArtist {
  return {
    ...artist,
    genres: artist.genres ?? [],
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
