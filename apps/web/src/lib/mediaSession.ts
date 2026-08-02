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

type MediaSessionHandlers = {
  play?: () => void;
  pause?: () => void;
  seekbackward?: (details: MediaSessionActionDetails) => void;
  seekforward?: (details: MediaSessionActionDetails) => void;
  previoustrack?: () => void;
  nexttrack?: () => void;
  seekto?: (details: MediaSessionActionDetails) => void;
};

function getMediaSession(): MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return null;
  }
  return navigator.mediaSession;
}

/** Populate iOS/Android lock-screen / Control Center Now Playing metadata. */
export function setMediaSessionMetadata(info: MediaSessionInfo) {
  const session = getMediaSession();
  if (!session || typeof MediaMetadata === "undefined") {
    return;
  }
  const artwork = (info.artwork ?? []).filter((item) => Boolean(item.src));
  session.metadata = new MediaMetadata({
    title: info.title,
    artist: info.artist ?? "",
    album: info.album ?? "JedFlix",
    artwork: artwork.length > 0 ? artwork : undefined,
  });
}

export function setMediaSessionPlaybackState(state: MediaSessionPlaybackState) {
  const session = getMediaSession();
  if (!session) {
    return;
  }
  session.playbackState = state;
}

export function setMediaSessionPositionState(opts: {
  duration: number;
  position: number;
  playbackRate?: number;
}) {
  const session = getMediaSession();
  if (!session || typeof session.setPositionState !== "function") {
    return;
  }
  if (!Number.isFinite(opts.duration) || opts.duration <= 0) {
    return;
  }
  const position = Math.max(0, Math.min(opts.position, opts.duration));
  try {
    session.setPositionState({
      duration: opts.duration,
      position,
      playbackRate: opts.playbackRate ?? 1,
    });
  } catch {
    // Some browsers throw if duration/position are briefly inconsistent.
  }
}

export function bindMediaSessionHandlers(handlers: MediaSessionHandlers) {
  const session = getMediaSession();
  if (!session) {
    return () => {};
  }

  const actions = Object.keys(handlers) as Array<keyof MediaSessionHandlers>;
  for (const action of actions) {
    const handler = handlers[action];
    if (!handler) {
      continue;
    }
    try {
      session.setActionHandler(action, handler as MediaSessionActionHandler);
    } catch {
      // Unsupported action on this platform.
    }
  }

  return () => {
    for (const action of actions) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
  };
}

export function artworkFromUrl(url?: string | null): MediaSessionArtwork[] {
  if (!url || url.includes("placehold.co")) {
    return [];
  }
  return [
    { src: url, sizes: "512x512", type: "image/jpeg" },
    { src: url, sizes: "256x256", type: "image/jpeg" },
  ];
}
