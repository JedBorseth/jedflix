/** Header set by the Go YouTube audio proxy after yt-dlp resolve. */
export const AUDIO_DURATION_HEADER = "X-Audio-Duration-Ms";
export const AUDIO_EXT_HEADER = "X-Audio-Ext";

/**
 * Choose the duration shown in the player / lock screen.
 *
 * HTML5 `audio.duration` for proxied YouTube AAC is often ~2× the real length.
 * Once yt-dlp resolves we have an exact duration — prefer that.
 */
export function pickMusicDurationSec(args: {
  catalogSec?: number | null;
  resolvedSec?: number | null;
  streamSec?: number | null;
}): number {
  const resolved = positiveSec(args.resolvedSec);
  if (resolved > 0) {
    return resolved;
  }
  const catalog = positiveSec(args.catalogSec);
  if (catalog > 0) {
    return catalog;
  }
  // Ignore HTML5 stream duration when it's the only signal — it is frequently
  // inflated and would show a ~2× progress bar until yt-dlp metadata arrives.
  void args.streamSec;
  return 0;
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
