/** Cap automatic source retries to avoid Real Debrid rate limits (250 req/min). */
export const MAX_AUTO_FALLBACKS = 2;

export function isFallbackError(errorCode?: string): boolean {
  return (
    errorCode === "infringing_file" ||
    errorCode === "timeout" ||
    errorCode === "no_video_file" ||
    errorCode === "title_mismatch" ||
    errorCode === "size_limit" ||
    errorCode === "no_links"
  );
}

export function isCompatFilterError(message?: string | null): boolean {
  if (!message) return false;
  return /browser-compatible|mkv\/remux|compatib/i.test(message);
}

/** HTMLMediaElement / Video.js MediaError codes */
export function mapVideoJsError(code?: number | null): string {
  switch (code) {
    case 1:
      return "Playback was aborted.";
    case 2:
      return "A network error interrupted playback. Try another compatible stream.";
    case 3:
      return "This stream could not be decoded in your browser. Try another compatible source or an external player.";
    case 4:
      return "This stream format is not supported in your browser. Try another source.";
    default:
      return "This stream could not be played. Try another compatible source or an external player.";
  }
}
