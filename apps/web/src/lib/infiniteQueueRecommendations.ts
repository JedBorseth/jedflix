import type { SpotifyTopTrack } from "@jedflix/stream-client";
import { createStreamClient } from "@jedflix/stream-client";
import { getSimilarTracks, topTrackToQueueFields } from "@/lib/lastfm";
import { getBackendApiBase } from "@/lib/backendEnv";
import type { MusicQueueTrack } from "@/components/player/music/MusicPlayerContext";

/** Keep upcoming queue topped up when it falls below this many tracks. */
export const INFINITE_QUEUE_THRESHOLD = 5;

/** How many auto-recommended tracks to append per refill. */
export const INFINITE_QUEUE_BATCH_SIZE = 5;

/** Visible preview of songs that will be added on the next refill. */
export const INFINITE_QUEUE_PREVIEW_SIZE = 5;

/** Avoid repeating the same primary artist within this many recent plays. */
export const ARTIST_COOLDOWN_WINDOW = 4;

export type RecommendationSeed = {
  title: string;
  artists: string[];
};

const streamClient = createStreamClient({
  apiBase: getBackendApiBase(),
});

/**
 * Modular recommendation picker for Infinite Queue.
 * Prefers the backend hybrid ranker (Last.fm + pgvector + Qwen rerank),
 * then falls back to a single Last.fm similar-tracks call.
 */
export async function generateInfiniteQueueTracks(options: {
  current: MusicQueueTrack | null;
  recent: MusicQueueTrack[];
  excludeIds: Set<string>;
  recentArtistNames: string[];
  limit?: number;
}): Promise<MusicQueueTrack[]> {
  const limit = options.limit ?? INFINITE_QUEUE_BATCH_SIZE;
  const seeds = buildSeeds(options.current, options.recent);
  if (seeds.length === 0 || !options.current) {
    return [];
  }

  try {
    const ranked = await streamClient.recommendMusic({
      seed: {
        id: options.current.id,
        title: options.current.title,
        artists: options.current.artists,
        albumName: options.current.albumName,
      },
      recent: options.recent.map((track) => ({
        id: track.id,
        title: track.title,
        artists: track.artists,
        albumName: track.albumName,
      })),
      excludeIds: [...options.excludeIds],
      recentArtistNames: options.recentArtistNames,
      limit,
    });
    const fromServer: MusicQueueTrack[] = [];
    for (const track of ranked.tracks ?? []) {
      if (!track.id || options.excludeIds.has(track.id)) {
        continue;
      }
      fromServer.push(topTrackToQueueFields(track));
      options.excludeIds.add(track.id);
      if (fromServer.length >= limit) {
        break;
      }
    }
    if (fromServer.length > 0) {
      return fromServer;
    }
  } catch {
    // Fall through to Last.fm-only refill.
  }

  const primary = seeds[0]!;
  const primaryArtist = primary.artists[0] ?? "";

  // One Spotify-backed resolve path only — do not also call /lastfm/related.
  const similarPool = await getSimilarTracks(
    primaryArtist,
    primary.title,
    Math.min(Math.max(limit + 2, 4), 6),
  );
  const shuffled = softShuffle(similarPool, 0.35);

  const cooldownArtists = new Set(
    options.recentArtistNames
      .slice(0, ARTIST_COOLDOWN_WINDOW)
      .map((name) => normalizeArtist(name))
      .filter(Boolean),
  );

  const out: MusicQueueTrack[] = [];
  const usedArtists = new Set<string>();

  for (const track of shuffled) {
    if (!track.id || options.excludeIds.has(track.id)) {
      continue;
    }
    const artistKey = normalizeArtist(track.artists[0] ?? "");
    if (artistKey && cooldownArtists.has(artistKey) && usedArtists.has(artistKey)) {
      continue;
    }
    // Soft artist spacing inside this batch.
    if (artistKey && usedArtists.has(artistKey) && out.length < limit) {
      // Allow later if we still need more tracks — skip for now and retry in second pass.
      continue;
    }
    out.push(topTrackToQueueFields(track));
    options.excludeIds.add(track.id);
    if (artistKey) {
      usedArtists.add(artistKey);
    }
    if (out.length >= limit) {
      break;
    }
  }

  // Second pass: fill remaining slots with less strict artist spacing.
  if (out.length < limit) {
    for (const track of shuffled) {
      if (!track.id || options.excludeIds.has(track.id)) {
        continue;
      }
      out.push(topTrackToQueueFields(track));
      options.excludeIds.add(track.id);
      if (out.length >= limit) {
        break;
      }
    }
  }

  return out;
}

function buildSeeds(
  current: MusicQueueTrack | null,
  recent: MusicQueueTrack[],
): RecommendationSeed[] {
  const seeds: RecommendationSeed[] = [];
  const seen = new Set<string>();

  const push = (track: MusicQueueTrack | null | undefined) => {
    if (!track?.title || track.artists.length === 0) {
      return;
    }
    const key = `${normalizeArtist(track.artists[0] ?? "")}|${track.title.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    seeds.push({ title: track.title, artists: track.artists });
  };

  push(current);
  for (const track of recent) {
    push(track);
    if (seeds.length >= 3) {
      break;
    }
  }
  return seeds;
}

function interleavePools(
  similar: SpotifyTopTrack[],
  explore: SpotifyTopTrack[],
): SpotifyTopTrack[] {
  const out: SpotifyTopTrack[] = [];
  const seen = new Set<string>();
  let i = 0;
  let j = 0;
  // 3 similar : 2 explore cadence for gradual exploration.
  while (i < similar.length || j < explore.length) {
    for (let n = 0; n < 3 && i < similar.length; n += 1, i += 1) {
      const track = similar[i]!;
      if (seen.has(track.id)) {
        continue;
      }
      seen.add(track.id);
      out.push(track);
    }
    for (let n = 0; n < 2 && j < explore.length; n += 1, j += 1) {
      const track = explore[j]!;
      if (seen.has(track.id)) {
        continue;
      }
      seen.add(track.id);
      out.push(track);
    }
  }
  return out;
}

/** Fisher–Yates on a fraction of adjacent swaps for light variety without destroying rank. */
function softShuffle<T>(items: T[], intensity: number): T[] {
  const out = [...items];
  const swaps = Math.floor(out.length * Math.max(0, Math.min(1, intensity)));
  for (let n = 0; n < swaps; n += 1) {
    const i = Math.floor(Math.random() * out.length);
    const j = Math.min(out.length - 1, i + 1 + Math.floor(Math.random() * 3));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function normalizeArtist(name: string): string {
  return name.trim().toLowerCase();
}

export function remainingUpcomingCount(queueLength: number, queueIndex: number): number {
  return Math.max(0, queueLength - queueIndex - 1);
}

export function shouldAppendInfiniteRecommendations(remaining: number): boolean {
  return remaining < INFINITE_QUEUE_THRESHOLD;
}

export function exclusionIdsFromTracks(
  ...lists: Array<ReadonlyArray<{ id: string } | null | undefined>>
): Set<string> {
  const ids = new Set<string>();
  for (const list of lists) {
    for (const track of list) {
      if (track?.id) {
        ids.add(track.id);
      }
    }
  }
  return ids;
}

export function uniqueQueueTracks<T extends { id: string; title: string; artists: string[] }>(
  incoming: T[],
  excludeIds: Iterable<string>,
  limit: number,
  existing: Array<{ title: string; artists: string[] }> = [],
): T[] {
  const seen = new Set(excludeIds);
  const nameKeys = new Set(
    existing.map(
      (track) =>
        `${normalizeArtist(track.artists[0] ?? "")}|${track.title.trim().toLowerCase()}`,
    ),
  );
  const out: T[] = [];
  for (const track of incoming) {
    if (!track.id || seen.has(track.id)) {
      continue;
    }
    const nameKey = `${normalizeArtist(track.artists[0] ?? "")}|${track.title.trim().toLowerCase()}`;
    if (nameKey !== "|" && nameKeys.has(nameKey)) {
      continue;
    }
    seen.add(track.id);
    if (nameKey !== "|") {
      nameKeys.add(nameKey);
    }
    out.push(track);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/** Pure helpers exported for unit tests. */
export const infiniteQueueInternals = {
  buildSeeds,
  interleavePools,
  softShuffle,
  normalizeArtist,
};
