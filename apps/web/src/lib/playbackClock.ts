export function formatPlaybackClock(seconds: number, showHours = false): string {
  const total = Math.floor(Math.max(0, seconds));
  const hours = showHours ? Math.floor(total / 3600) : 0;
  const minutes = Math.floor((hours > 0 ? total % 3600 : total) / 60);
  const paddedSeconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}
