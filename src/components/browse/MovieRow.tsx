import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { MovieCard } from "./MovieCard";

type MovieRowProps = {
  genre: string;
};

export function MovieRow({ genre }: MovieRowProps) {
  const movies = useQuery(api.movies.listByGenre, { genre });

  if (movies === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{genre}</h2>
        <div className="flex gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-52 w-36 shrink-0 animate-pulse rounded-md bg-zinc-800 md:w-44"
            />
          ))}
        </div>
      </section>
    );
  }

  if (movies.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{genre}</h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {movies.map((movie) => (
          <MovieCard key={movie._id} movie={movie} />
        ))}
      </div>
    </section>
  );
}
