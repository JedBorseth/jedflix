import { getYoutubeAudioUrl } from "@/lib/spotify";
import {
  AUDIO_EXT_HEADER,
  durationMsFromAudioHeaders,
} from "@/lib/musicDuration";

export type PrefetchTrack = {
  id: string;
  title: string;
  artists: string[];
  albumName: string;
  durationMs: number;
  youtubeVideoId?: string;
};

export type YoutubeAudioMetadata = {
  durationMs: number | null;
  ext: string | null;
};

export type PrefetchYoutubeAudioResult = {
  warmed: string[];
  durationMsByTrackId: Record<string, number>;
};

function artistLabel(artists: string[]): string {
  return artists.filter(Boolean).join(", ") || "Unknown artist";
}

function trackUrl(track: PrefetchTrack): string {
  const videoId =
    track.youtubeVideoId ||
    (track.id.startsWith("yt:") ? track.id.slice(3) : undefined);
  return getYoutubeAudioUrl({
    artist: artistLabel(track.artists),
    title: track.title,
    album: track.albumName,
    durationMs: track.durationMs > 0 ? track.durationMs : undefined,
    videoId,
  });
}

export async function fetchYoutubeAudioMetadata(
  url: string,
  options?: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<YoutubeAudioMetadata> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      signal: options?.signal,
    });
    if (!response.ok && response.status !== 206) {
      return { durationMs: null, ext: null };
    }
    return {
      durationMs: durationMsFromAudioHeaders(response.headers),
      ext: response.headers.get(AUDIO_EXT_HEADER),
    };
  } catch {
    return { durationMs: null, ext: null };
  }
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
): Promise<PrefetchYoutubeAudioResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const warmed: string[] = [];
  const durationMsByTrackId: Record<string, number> = {};
  const seen = options?.alreadyPrefetched ?? new Set<string>();

  // One at a time so prefetch cannot starve the track that is actually playing.
  for (const track of tracks) {
    if (options?.signal?.aborted) {
      break;
    }
    if (seen.has(track.id)) {
      continue;
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
        const durationMs = durationMsFromAudioHeaders(response.headers);
        if (durationMs) {
          durationMsByTrackId[track.id] = durationMs;
        }
      } else if (response.status === 429) {
        seen.delete(track.id);
        break;
      }
    } catch {
      // Prefetch is best-effort; ignore network / abort errors.
      seen.delete(track.id);
    }
  }

  return { warmed, durationMsByTrackId };
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
