/**
 * Artwork for large queues is kept out of React state until a row is shown
 * (or a track starts playing). URLs still live in this module cache so scrolling
 * the queue or advancing playback can hydrate without refetching Spotify.
 */

const artworkByTrackId = new Map<string, string>();

/** Keep full artwork in React state only for small queues. */
export const ARTWORK_FULL_QUEUE_LIMIT = 80;

/** Keep artwork on the current track and a few neighbors in queue state. */
export const ARTWORK_KEEP_RADIUS = 2;

export function rememberTrackArtwork(
  tracks: ReadonlyArray<{ id: string; imageUrl: string }>,
): void {
  for (const track of tracks) {
    if (track.id && track.imageUrl) {
      artworkByTrackId.set(track.id, track.imageUrl);
    }
  }
}

export function artworkForTrack(trackId: string, fallback = ""): string {
  return artworkByTrackId.get(trackId) ?? fallback;
}

export function withCachedArtwork<T extends { id: string; imageUrl: string }>(
  track: T,
): T {
  if (track.imageUrl) {
    return track;
  }
  const cached = artworkByTrackId.get(track.id);
  if (!cached) {
    return track;
  }
  return { ...track, imageUrl: cached };
}

/**
 * Remember all artwork, then clear `imageUrl` on tracks outside the keep window
 * so opening a 1000+ song queue does not mount thousands of Spotify CDN images.
 */
export function stripQueueArtwork<T extends { id: string; imageUrl: string }>(
  tracks: T[],
  keepAroundIndex: number,
  radius: number = ARTWORK_KEEP_RADIUS,
): T[] {
  if (tracks.length <= ARTWORK_FULL_QUEUE_LIMIT) {
    rememberTrackArtwork(tracks);
    return tracks;
  }

  rememberTrackArtwork(tracks);
  const safeIndex = Math.min(Math.max(keepAroundIndex, 0), Math.max(tracks.length - 1, 0));

  return tracks.map((track, index) => {
    if (Math.abs(index - safeIndex) <= radius) {
      return track.imageUrl
        ? track
        : withCachedArtwork(track);
    }
    if (!track.imageUrl) {
      return track;
    }
    return { ...track, imageUrl: "" };
  });
}

/**
 * Grow `prev` when `next` is the same ordered list with more items appended
 * (playlist / liked pagination). Returns `prev` when the user reordered or the
 * source no longer matches.
 */
export function extendQueueIfPrefix<T extends { id: string }>(
  prev: T[],
  next: T[],
): T[] | null {
  if (next.length <= prev.length) {
    return null;
  }
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i]?.id !== next[i]?.id) {
      return null;
    }
  }
  return next;
}

/**
 * Decide how to apply a newer source playlist snapshot onto the player queue.
 * Returns null when nothing should change (same ids, or next is not useful).
 */
export function planQueueSourceSync<T extends { id: string }>(args: {
  prev: T[];
  next: T[];
  currentId: string | null;
}): { queue: T[]; queueIndex: number } | null {
  const { prev, next, currentId } = args;
  if (next.length === 0) {
    return null;
  }
  if (
    next.length === prev.length &&
    next.every((track, index) => track.id === prev[index]?.id)
  ) {
    return null;
  }

  let queueIndex = 0;
  if (currentId) {
    const found = next.findIndex((track) => track.id === currentId);
    if (found >= 0) {
      queueIndex = found;
    } else if (prev.length > 0) {
      // Current track missing from source — keep playback; do not clobber.
      return null;
    }
  }

  return { queue: next, queueIndex };
}
