/**
 * Heuristic for progressive HTTP playback in browsers / Safari / iOS: MKV
 * containers and lossless or Dolby surround tracks commonly fail or play
 * without audio. Keep in sync with incompatiblePattern in
 * apps/backend/internal/search/scorepick.go, which filters and ranks sources.
 */
const INCOMPATIBLE_PATTERN =
  /\.mkv\b|\bmkv\b|\bremux\b|\btruehd\b|\batmos\b|\bdts(?:-?hd)?\b|\bac3\b|\beac3\b|\bdd\+\b|\bddp\b|\bdolby digital\b/i;

export function isDirectPlaybackIncompatible(label: string): boolean {
  return INCOMPATIBLE_PATTERN.test(label);
}

export const DIRECT_PLAYBACK_HINT =
  "Direct streaming works best with MP4 / H.264 / AAC releases. MKV, Remux, Atmos, TrueHD, and DTS sources are hidden because browsers and iOS often cannot play them.";
