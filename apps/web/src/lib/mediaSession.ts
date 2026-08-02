export type MediaSessionArtwork = {
  src: string;
  sizes?: string;
  type?: string;
};

export type MediaSessionInfo = {
  title: string;
  artist?: string;
  album?: string;
  artwork?: MediaSessionArtwork[];
};

export type MediaSessionPlaybackState = "none" | "paused" | "playing";

const FALLBACK_ARTWORK: MediaSessionArtwork[] = [
  { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
  { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
];

const MEDIA_SESSION_ACTIONS = [
  "play",
  "pause",
  "seekbackward",
  "seekforward",
  "seekto",
  "previoustrack",
  "nexttrack",
  "stop",
] as const;

export function toAbsoluteMediaUrl(url: string, origin = defaultOrigin()): string {
  if (!url) {
    return url;
  }
  try {
    return new URL(url, origin).href;
  } catch {
    return url;
  }
}

function defaultOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost";
}

/** Build lock-screen / Now Playing artwork entries from a poster or cover URL. */
export function artworkFromImageUrl(
  url: string | null | undefined,
  origin = defaultOrigin(),
): MediaSessionArtwork[] {
  if (!url || url.includes("placehold.co")) {
    return FALLBACK_ARTWORK.map((item) => ({
      ...item,
      src: toAbsoluteMediaUrl(item.src, origin),
    }));
  }

  const absolute = toAbsoluteMediaUrl(url, origin);
  const tmdbMatch = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/.+)$/i.exec(absolute);
  if (tmdbMatch) {
    const [, prefix, path] = tmdbMatch;
    return [
      { src: `${prefix}w185${path}`, sizes: "185x278", type: "image/jpeg" },
      { src: `${prefix}w342${path}`, sizes: "342x513", type: "image/jpeg" },
      { src: `${prefix}w500${path}`, sizes: "500x750", type: "image/jpeg" },
    ];
  }

  return [{ src: absolute, sizes: "512x512", type: "image/jpeg" }];
}

export function formatWatchSessionTitle(
  title: string,
  mediaType: "movie" | "tv",
  season?: number,
  episode?: number,
): string {
  if (mediaType === "tv" && Number.isFinite(season) && Number.isFinite(episode)) {
    const seasonLabel = String(season).padStart(2, "0");
    const episodeLabel = String(episode).padStart(2, "0");
    return `${title} · S${seasonLabel}E${episodeLabel}`;
  }
  return title;
}

export function isPlayAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    /operation was aborted/i.test(error.message) ||
    /play\(\) request was interrupted/i.test(error.message)
  );
}

/**
 * Start playback while ignoring AbortError from seek/src races.
 * Returns whether a real (non-abort) failure occurred.
 */
export async function playMediaElement(media: HTMLMediaElement): Promise<Error | null> {
  try {
    await media.play();
    return null;
  } catch (error: unknown) {
    if (isPlayAbortError(error)) {
      // Seek, pause, or a newer play() interrupted this call — not a real failure.
      return null;
    }
    return error instanceof Error ? error : new Error("Could not start playback");
  }
}

export function hasMediaSessionSupport(
  mediaSession: MediaSession | undefined = typeof navigator !== "undefined"
    ? navigator.mediaSession
    : undefined,
): mediaSession is MediaSession {
  return Boolean(mediaSession) && typeof MediaMetadata !== "undefined";
}

export function setMediaSessionMetadata(
  info: MediaSessionInfo,
  mediaSession: MediaSession | undefined = typeof navigator !== "undefined"
    ? navigator.mediaSession
    : undefined,
): void {
  if (!hasMediaSessionSupport(mediaSession)) {
    return;
  }

  mediaSession.metadata = new MediaMetadata({
    title: info.title,
    artist: info.artist || "JedFlix",
    album: info.album || "JedFlix",
    artwork: info.artwork?.length ? info.artwork : artworkFromImageUrl(null),
  });
}

export function setMediaSessionPlaybackState(
  state: MediaSessionPlaybackState,
  mediaSession: MediaSession | undefined = typeof navigator !== "undefined"
    ? navigator.mediaSession
    : undefined,
): void {
  if (!hasMediaSessionSupport(mediaSession)) {
    return;
  }
  mediaSession.playbackState = state;
}

export function setMediaSessionPositionState(
  position: { duration: number; position: number; playbackRate?: number } | null,
  mediaSession: MediaSession | undefined = typeof navigator !== "undefined"
    ? navigator.mediaSession
    : undefined,
): void {
  if (!hasMediaSessionSupport(mediaSession) || typeof mediaSession.setPositionState !== "function") {
    return;
  }

  if (!position || !Number.isFinite(position.duration) || position.duration <= 0) {
    try {
      mediaSession.setPositionState();
    } catch {
      // Older browsers may reject clearing position state.
    }
    return;
  }

  const duration = position.duration;
  const current = Math.max(0, Math.min(position.position, duration));
  const playbackRate =
    Number.isFinite(position.playbackRate) && (position.playbackRate ?? 0) > 0
      ? position.playbackRate!
      : 1;

  try {
    mediaSession.setPositionState({
      duration,
      position: current,
      playbackRate,
    });
  } catch {
    // Some browsers throw if position > duration during seek transitions.
  }
}

export function clearMediaSessionActionHandlers(
  mediaSession: MediaSession | undefined = typeof navigator !== "undefined"
    ? navigator.mediaSession
    : undefined,
): void {
  if (!hasMediaSessionSupport(mediaSession)) {
    return;
  }

  for (const action of MEDIA_SESSION_ACTIONS) {
    try {
      mediaSession.setActionHandler(action, null);
    } catch {
      // Unsupported action on this browser.
    }
  }
}

export function clearMediaSession(
  mediaSession: MediaSession | undefined = typeof navigator !== "undefined"
    ? navigator.mediaSession
    : undefined,
): void {
  if (!hasMediaSessionSupport(mediaSession)) {
    return;
  }

  clearMediaSessionActionHandlers(mediaSession);
  mediaSession.metadata = null;
  mediaSession.playbackState = "none";
  setMediaSessionPositionState(null, mediaSession);
}
