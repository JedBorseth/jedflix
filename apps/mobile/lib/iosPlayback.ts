import { Platform } from "react-native";
import type { StreamSource } from "@jedflix/stream-client";

export function isIosDevice(): boolean {
  return Platform.OS === "ios";
}

export function scoreIosPlaybackCompatibility(title: string): number {
  const lower = title.toLowerCase();
  let score = 0;

  if (/remux/i.test(lower)) score -= 100;
  if (/dts|truehd|atmos|ac3|eac3/i.test(lower)) score -= 50;
  if (/\.mp4\b/i.test(title) || /\bmp4\b/i.test(lower)) score += 40;
  if (/web[-.]?dl|webrip/i.test(lower)) score += 30;
  if (/x264|h\.?264/i.test(lower)) score += 25;
  if (/aac/i.test(lower)) score += 20;
  if (/\.mkv\b/i.test(title) || /\bmkv\b/i.test(lower)) score -= 10;

  return score;
}

export function sortSourcesForMobilePlayback(sources: StreamSource[]): StreamSource[] {
  if (!isIosDevice()) return sources;

  return [...sources].sort((left, right) => {
    const cachedDelta = Number(right.cached) - Number(left.cached);
    if (cachedDelta !== 0) return cachedDelta;

    const scoreDelta =
      scoreIosPlaybackCompatibility(right.title) - scoreIosPlaybackCompatibility(left.title);
    if (scoreDelta !== 0) return scoreDelta;

    return (right.seeders ?? 0) - (left.seeders ?? 0);
  });
}

export const IOS_PLAYBACK_HINT =
  "iOS often cannot play MKV/remux streams with DTS audio. Web-DL or x264 MP4 releases work best.";

export function isLikelyIosIncompatible(filename?: string, title?: string): boolean {
  const combined = `${filename ?? ""} ${title ?? ""}`.toLowerCase();
  return /\.mkv\b/i.test(combined) || /remux|dts|truehd|atmos/i.test(combined);
}
