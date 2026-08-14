/** Concert/bootleg titles — not studio songs that merely contain "live". */
const LIVE_PHRASES = [
  "live at",
  "live from",
  "live in concert",
  "live performance",
  "live version",
  "live session",
  "live album",
  "on tour",
  "(live)",
  "[live]",
  "{live}",
  " live:",
  ": live",
  "- live",
  "– live",
  "— live",
  "/live",
  " / live",
  "bootleg",
];

const CONCERT_DATE_PREFIX = /^\d{4}[-/]\d{2}[-/]\d{2}/;

export function looksLikeLiveRecording(text: string | undefined | null): boolean {
  const lower = text?.trim().toLowerCase() ?? "";
  if (!lower) {
    return false;
  }
  if (CONCERT_DATE_PREFIX.test(lower)) {
    return true;
  }
  if (LIVE_PHRASES.some((phrase) => lower.includes(phrase))) {
    return true;
  }
  return lower.endsWith(" live");
}

/**
 * Live album names and concert durations bias YouTube toward bootlegs that
 * often fail to extract. Drop those hints unless the track title itself is live.
 */
export function youtubeAudioQueryHints(input: {
  title: string;
  albumName?: string;
  durationMs?: number;
}): { album?: string; durationMs?: number } {
  const album = input.albumName?.trim() || undefined;
  const durationMs =
    input.durationMs && Number.isFinite(input.durationMs) && input.durationMs > 0
      ? input.durationMs
      : undefined;
  const albumIsLive = looksLikeLiveRecording(album);
  const titleIsLive = looksLikeLiveRecording(input.title);
  if (albumIsLive && !titleIsLive) {
    return {};
  }
  return { album, durationMs };
}
