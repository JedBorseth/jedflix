/** Cap automatic source retries to avoid Real Debrid rate limits (250 req/min). */
export const MAX_AUTO_FALLBACKS = 2;

export function isFallbackError(errorCode?: string): boolean {
  return (
    errorCode === "infringing_file" ||
    errorCode === "timeout" ||
    errorCode === "no_video_file" ||
    errorCode === "title_mismatch" ||
    errorCode === "size_limit" ||
    errorCode === "no_links" ||
    errorCode === "magnet_error"
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

/** Expand terse browser/network errors (esp. Safari "Load failed") into actionable text. */
export function formatStreamFailure(error: unknown, fallback = "Failed to resolve stream"): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim() || fallback;
  const lower = message.toLowerCase();

  if (
    lower === "load failed" ||
    lower === "failed to fetch" ||
    lower === "networkerror when attempting to fetch resource." ||
    (error.name === "TypeError" && /load failed|fetch/i.test(message))
  ) {
    return (
      "Network request failed while talking to the stream server " +
      `(browser said: "${message}"). This is often a mobile timeout or dropped connection during Real Debrid resolve — wait a moment and try again, or pick another source.`
    );
  }

  if (error.name === "AbortError" || lower.includes("aborted") || lower.includes("cancelled")) {
    return `Resolve was cancelled before finishing (${message}).`;
  }

  return message;
}

export function mapMediaElementError(media: HTMLMediaElement | null): string {
  const mediaError = media?.error;
  if (!mediaError) {
    return "Playback failed for an unknown reason.";
  }
  const base = mapVideoJsError(mediaError.code);
  const detail = mediaError.message?.trim();
  if (!detail) {
    return `${base} (media error code ${mediaError.code}).`;
  }
  if (/^load failed$/i.test(detail)) {
    return (
      `${base} The browser could not load the media URL ` +
      `(Safari often reports this as "Load failed" for network, CORS, or unsupported audio formats). Try another source.`
    );
  }
  return `${base} ${detail}`;
}

/** When HTML audio gets JSON from the stream-server, surface the server message instead of "no supported sources". */
export async function resolveStreamServerAudioError(
  media: HTMLMediaElement,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const base = mapMediaElementError(media);
  const src = media.currentSrc || media.src;
  if (!src || media.error?.code !== 4) {
    return base;
  }

  try {
    const response = await fetchImpl(src);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      return base;
    }
    const payload = (await response.json()) as { error?: string };
    if (!payload.error) {
      return base;
    }
    if (/yt-dlp is not installed/i.test(payload.error)) {
      return "Music playback requires yt-dlp on the stream-server. Install locally with: brew install yt-dlp";
    }
    return payload.error;
  } catch {
    return base;
  }
}
