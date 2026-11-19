/** Header set by the Go YouTube audio proxy after yt-dlp resolve. */
export const AUDIO_DURATION_HEADER = "X-Audio-Duration-Ms";
export const AUDIO_EXT_HEADER = "X-Audio-Ext";

/**
 * Choose the duration shown in the player / lock screen.
 *
 * HTML5 `audio.duration` for proxied YouTube AAC is often ~2× the real length.
 * Use the catalog duration when available, with yt-dlp metadata as a fallback.
 */
export function pickMusicDurationSec(args: {
  catalogSec?: number | null;
  resolvedSec?: number | null;
  streamSec?: number | null;
}): number {
  return positiveSec(args.catalogSec) || positiveSec(args.resolvedSec);
}

export function durationMsFromAudioHeaders(headers: Headers): number | null {
  const raw = headers.get(AUDIO_DURATION_HEADER);
  if (!raw) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function positiveSec(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}
