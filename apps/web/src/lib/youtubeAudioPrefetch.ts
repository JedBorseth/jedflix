import { getYoutubeAudioUrl } from "@/lib/spotify";

export type PrefetchTrack = {
  id: string;
  title: string;
  artists: string[];
  albumName: string;
  durationMs: number;
  youtubeVideoId?: string;
};

function artistLabel(artists: string[]): string {
  return artists.filter(Boolean).join(", ") || "Unknown artist";
}

function trackUrl(track: PrefetchTrack): string {
  if (track.youtubeVideoId) {
    return getYoutubeAudioUrl({ videoId: track.youtubeVideoId });
  }
  return getYoutubeAudioUrl({
    artist: artistLabel(track.artists),
    title: track.title,
    album: track.albumName,
    durationMs: track.durationMs > 0 ? track.durationMs : undefined,
  });
}

/**
 * Warm the stream-server YouTube resolver cache for upcoming tracks.
 * Uses HEAD so we resolve Spotify→YouTube without downloading audio bodies.
 */
export async function prefetchYoutubeAudioTracks(
  tracks: PrefetchTrack[],
  options?: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    alreadyPrefetched?: Set<string>;
  },
): Promise<string[]> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const warmed: string[] = [];
  const seen = options?.alreadyPrefetched ?? new Set<string>();

  await Promise.all(
    tracks.map(async (track) => {
      if (seen.has(track.id)) {
        return;
      }
      seen.add(track.id);
      const url = trackUrl(track);
      try {
        const response = await fetchImpl(url, {
          method: "HEAD",
          signal: options?.signal,
        });
        if (response.ok || response.status === 206) {
          warmed.push(track.id);
        }
      } catch {
        // Prefetch is best-effort; ignore network / abort errors.
        seen.delete(track.id);
      }
    }),
  );

  return warmed;
}

/** Return the next `count` tracks after `queueIndex` for prefetching. */
export function upcomingTracksForPrefetch<T>(
  queue: T[],
  queueIndex: number,
  count = 2,
): T[] {
  if (count <= 0 || queueIndex < 0) {
    return [];
  }
  return queue.slice(queueIndex + 1, queueIndex + 1 + count);
}
