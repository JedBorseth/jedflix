import { detectExternalPlayerPlatform } from "@/lib/externalPlayer";
import type { StreamSource } from "@/lib/streamApi";

export function isIosDevice(): boolean {
  return detectExternalPlayerPlatform() === "ios";
}

export function scoreIosBrowserCompatibility(title: string): number {
  const lower = title.toLowerCase();
  let score = 0;

  if (/remux/i.test(lower)) {
    score -= 100;
  }
  if (/dts|truehd|atmos|ac3|eac3/i.test(lower)) {
    score -= 50;
  }
  if (/\.mp4\b/i.test(title) || /\bmp4\b/i.test(lower)) {
    score += 40;
  }
  if (/web[-.]?dl|webrip/i.test(lower)) {
    score += 30;
  }
  if (/x264|h\.?264/i.test(lower)) {
    score += 25;
  }
  if (/aac/i.test(lower)) {
    score += 20;
  }
  if (/\.mkv\b/i.test(title) || /\bmkv\b/i.test(lower)) {
    score -= 10;
  }

  return score;
}

export function sortSourcesForIosPlayback(sources: StreamSource[]): StreamSource[] {
  if (!isIosDevice()) {
    return sources;
  }

  return [...sources].sort((left, right) => {
    const scoreDelta =
      scoreIosBrowserCompatibility(right.title) - scoreIosBrowserCompatibility(left.title);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return 0;
  });
}

export const IOS_PLAYBACK_ERROR_HINT =
  "Safari on iOS often cannot play remux or MKV streams with DTS/AC3 audio. Try a Web-DL or x264 release, switch to proxy mode, or use an external player like VLC or OutPlayer.";
