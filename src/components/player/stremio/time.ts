/** @stremio/stremio-video HTMLVideo reports time and duration in milliseconds. */
export function toDisplaySeconds(timeMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    return 0;
  }
  return timeMs / 1000;
}

export function toPlayerTimeMs(seconds: number): number {
  return Math.round(seconds * 1000);
}
