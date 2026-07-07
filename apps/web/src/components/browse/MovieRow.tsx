import { useEffect, useState } from "react";
import { MovieCard } from "./MovieCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import type { MediaItem, MediaType } from "@/lib/types";
import { discoverMedia } from "@/lib/tmdb";

type MovieRowProps = {
  title: string;
  mediaType: MediaType;
  genreId?: number;
};

export function MovieRow({ title, mediaType, genreId }: MovieRowProps) {
  const [movies, setMovies] = useState<MediaItem[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMovies(undefined);
    setError(null);

    discoverMedia(mediaType, { genreId })
      .then((items) => {
        if (!cancelled) {
          setMovies(items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load titles");
          setMovies([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [genreId, mediaType]);

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
