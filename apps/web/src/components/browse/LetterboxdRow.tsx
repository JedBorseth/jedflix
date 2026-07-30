import { useQuery } from "@tanstack/react-query";
import { MovieCard } from "@/components/browse/MovieCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { useUserSettings } from "@/hooks/useUserSettings";
import { catalogQueryKeys } from "@/lib/queryClient";
import { fetchLetterboxdFilmsByDate } from "@/lib/streamApi";
import { getMediaDetailsByIds } from "@/lib/tmdb";
import type { MediaItem } from "@/lib/types";

const ROW_LIMIT = 12;

type LetterboxdRowProps = {
  title?: string;
};

async function loadLetterboxdRow(username: string): Promise<MediaItem[]> {
  const response = await fetchLetterboxdFilmsByDate(username);
  const withTmdb = response.films
    .filter((film) => typeof film.tmdbId === "number" && film.tmdbId > 0)
    .slice(0, ROW_LIMIT)
    .map((film) => ({
      mediaType: "movie" as const,
      movieId: film.tmdbId as number,
    }));

  if (withTmdb.length === 0) {
    return [];
  }

  const details = await getMediaDetailsByIds(withTmdb);
  const byId = new Map(details.map((item) => [item.id, item]));
  return withTmdb
    .map((item) => byId.get(item.movieId))
    .filter((item): item is MediaItem => item !== undefined);
}

export function LetterboxdRow({ title = "From Letterboxd" }: LetterboxdRowProps) {
  const { letterboxdUsername } = useUserSettings();
  const username = letterboxdUsername.trim();

  const filmsQuery = useQuery({
    queryKey: catalogQueryKeys.letterboxd.films(username),
    queryFn: () => loadLetterboxdRow(username),
    enabled: Boolean(username),
  });

  if (!username) {
    return null;
  }

  if (filmsQuery.data === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">
          {title}
          <span className="ml-2 text-sm font-normal text-zinc-500">@{letterboxdUsername}</span>
        </h2>
        <PosterRowSkeleton count={4} />
      </section>
    );
  }

  if (filmsQuery.isError || filmsQuery.data.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">
        {title}
        <span className="ml-2 text-sm font-normal text-zinc-500">@{letterboxdUsername}</span>
      </h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {filmsQuery.data.map((movie) => (
          <MovieCard key={`letterboxd-${movie.id}`} movie={movie} />
        ))}
      </div>
    </section>
  );
}
