import type { SpotifyTopTrack } from "@jedflix/stream-client";
import { getRelatedMusic, getSimilarTracks, topTrackToQueueFields } from "@/lib/lastfm";
import type { MusicQueueTrack } from "@/components/player/music/MusicPlayerContext";

/** Keep upcoming queue topped up when it falls below this many tracks. */
export const INFINITE_QUEUE_THRESHOLD = 3;

/** How many auto-recommended tracks to append per refill. */
export const INFINITE_QUEUE_BATCH_SIZE = 8;

/** Avoid repeating the same primary artist within this many recent plays. */
export const ARTIST_COOLDOWN_WINDOW = 4;

export type RecommendationSeed = {
  title: string;
  artists: string[];
};

/**
 * Modular recommendation picker for Infinite Queue.
 * Mixes highly-similar tracks with related-artist exploration and light shuffling.
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
  if (seeds.length === 0) {
    return [];
  }

  const primary = seeds[0]!;
  const primaryArtist = primary.artists[0] ?? "";

  const [similarFromCurrent, related] = await Promise.all([
    getSimilarTracks(primaryArtist, primary.title, Math.max(limit * 2, 12)),
    getRelatedMusic({
      artist: primaryArtist,
      track: primary.title,
      seeds: seeds.slice(1).map((seed) => ({
        artist: seed.artists[0] ?? "",
        track: seed.title,
      })),
      limit: Math.max(limit, 10),
    }),
  ]);

  // Weight: ~60% similar tracks, ~40% related/exploration (from other seeds / artists).
  const similarPool = similarFromCurrent;
  const explorePool = related.tracks ?? [];

  const mixed = interleavePools(similarPool, explorePool);
  const shuffled = softShuffle(mixed, 0.35);

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
    if (seeds.length >= 5) {
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

/** Pure helpers exported for unit tests. */
export const infiniteQueueInternals = {
  buildSeeds,
  interleavePools,
  softShuffle,
  normalizeArtist,
};
