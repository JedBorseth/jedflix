/**
 * Heuristics for progressive HTTP playback in browsers / Safari / iOS.
 * MKV containers and lossless surround tracks commonly fail or play without audio.
 */

const INCOMPATIBLE_PATTERN =
  /\.mkv\b|\bmkv\b|\bremux\b|\btruehd\b|\batmos\b|\bdts(?:-?hd)?\b|\bac3\b|\beac3\b|\bdd\+\b|\bddp\b/i;

const COMPATIBLE_CONTAINER_PATTERN = /\.mp4\b|\bm4v\b|\bmp4\b/i;
const COMPATIBLE_VIDEO_PATTERN = /\bx264\b|\bh\.?264\b|\bavc\b/i;
const COMPATIBLE_AUDIO_PATTERN = /\baac\b/i;
const PREFERRED_SOURCE_PATTERN = /web[-.]?dl|webrip/i;

export function isDirectPlaybackIncompatible(label: string): boolean {
  return INCOMPATIBLE_PATTERN.test(label);
}

export function scoreDirectPlaybackCompatibility(label: string): number {
  if (isDirectPlaybackIncompatible(label)) {
    return -1000;
  }

  let score = 0;
  if (COMPATIBLE_CONTAINER_PATTERN.test(label)) {
    score += 40;
  }
  if (PREFERRED_SOURCE_PATTERN.test(label)) {
    score += 30;
  }
  if (COMPATIBLE_VIDEO_PATTERN.test(label)) {
    score += 25;
  }
  if (COMPATIBLE_AUDIO_PATTERN.test(label)) {
    score += 20;
  }
  return score;
}

export function filterDirectPlaybackSources<T extends { title: string }>(sources: T[]): T[] {
  return sources.filter((source) => !isDirectPlaybackIncompatible(source.title));
}

export function sortDirectPlaybackSources<T extends { title: string; cached?: boolean; seeders?: number }>(
  sources: T[],
): T[] {
  return [...sources].sort((left, right) => {
    const cachedDelta = Number(right.cached) - Number(left.cached);
    if (cachedDelta !== 0) {
      return cachedDelta;
    }

    const scoreDelta =
      scoreDirectPlaybackCompatibility(right.title) -
      scoreDirectPlaybackCompatibility(left.title);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return (right.seeders ?? 0) - (left.seeders ?? 0);
  });
}

export const DIRECT_PLAYBACK_HINT =
  "Direct streaming works best with MP4 / H.264 / AAC releases. MKV, Remux, Atmos, TrueHD, and DTS sources are hidden because browsers and iOS often cannot play them.";
