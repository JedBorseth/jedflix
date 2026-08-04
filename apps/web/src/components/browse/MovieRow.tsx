import { useQuery } from "@tanstack/react-query";
import { MovieCard } from "./MovieCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { catalogQueryKeys } from "@/lib/queryClient";
import type { MediaType } from "@/lib/types";
import { discoverMedia } from "@/lib/tmdb";

type MovieRowProps = {
  title: string;
  mediaType: MediaType;
  genreId?: number;
  watchProviderId?: number;
};

export function MovieRow({
  title,
  mediaType,
  genreId,
  watchProviderId,
}: MovieRowProps) {
  const moviesQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.discover(mediaType, {
      genreId,
      watchProviderId,
    }),
    queryFn: () => discoverMedia(mediaType, { genreId, watchProviderId }),
  });

  const movies = moviesQuery.data;
  const error = moviesQuery.error
    ? moviesQuery.error instanceof Error
      ? moviesQuery.error.message
      : "Unable to load titles"
    : null;

  if (movies === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
        <PosterRowSkeleton />
      </section>
    );
  }

  if (error) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
        <p className="text-sm text-zinc-500">{error}</p>
      </section>
    );
  }

  if (movies.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {movies.map((movie) => (
          <MovieCard key={`${movie.mediaType}-${movie.id}`} movie={movie} />
        ))}
      </div>
    </section>
  );
}
