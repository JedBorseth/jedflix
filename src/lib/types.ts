export type MediaType = "movie" | "tv";

export type MediaItem = {
  id: number;
  mediaType: MediaType;
  title: string;
  description: string;
  posterUrl: string;
  backdropUrl: string;
  year: number | null;
  releaseDate: string | null;
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

export type CastMember = {
  id: number;
  name: string;
  character: string;
  profileUrl: string;
};

export type PersonSummary = {
  id: number;
  name: string;
  profileUrl: string;
  knownFor?: string;
};

export type FilmographyItem = MediaItem & {
  character?: string;
};

export type PersonDetails = PersonSummary & {
  biography: string;
  birthday: string | null;
  knownFor: FilmographyItem[];
  filmography: FilmographyItem[];
};

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function parseReleaseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return date;
}

export function isMediaReleased(
  media: Pick<MediaItem, "releaseDate" | "year">,
  now = new Date(),
): boolean {
  if (media.releaseDate) {
    const releaseDate = parseReleaseDate(media.releaseDate);
    if (releaseDate) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return releaseDate <= today;
    }
  }

  if (media.year !== null && media.year > now.getFullYear()) {
    return false;
  }

  return true;
}
