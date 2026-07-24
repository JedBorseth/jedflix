export function isFallbackError(errorCode?: string): boolean {
  return (
    errorCode === "infringing_file" ||
    errorCode === "timeout" ||
    errorCode === "no_video_file" ||
    errorCode === "size_limit" ||
    errorCode === "no_links"
  );
}

/** HTMLMediaElement / Video.js MediaError codes */
export function mapVideoJsError(code?: number | null): string {
  switch (code) {
    case 1:
      return "Playback was aborted.";
    case 2:
      return "A network error interrupted playback. Try proxy mode or another stream.";
    case 3:
      return "This stream could not be decoded in your browser. Try another source or use proxy mode.";
    case 4:
      return "This stream format is not supported in your browser. Try another source.";
    default:
      return "This stream could not be played. Try another source or use proxy mode.";
  }
}
