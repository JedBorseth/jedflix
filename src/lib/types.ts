import type { Doc } from "../../convex/_generated/dataModel";

export type Movie = Doc<"movies">;

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  return `${hours}h ${remainingMinutes}m`;
}
