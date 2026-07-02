export type MediaType = "movie" | "tv";

export type MediaItem = {
  id: number;
  mediaType: MediaType;
  title: string;
  description: string;
  posterUrl: string;
  backdropUrl: string;
  year: number | null;
  rating: string;
  genre?: string;
  durationMinutes?: number;
  imdbId?: string;
};

export type WatchProgressKey = {
  mediaType: MediaType;
  movieId: number;
  season?: number;
  episode?: number;
};

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  return `${hours}h ${remainingMinutes}m`;
}
