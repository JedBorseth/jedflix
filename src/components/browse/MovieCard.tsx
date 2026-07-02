import { Link } from "react-router-dom";
import type { Movie } from "@/lib/types";

type MovieCardProps = {
  movie: Movie;
};

export function MovieCard({ movie }: MovieCardProps) {
  return (
    <Link
      to={`/movie/${movie._id}`}
      className="group relative block w-36 shrink-0 snap-start md:w-44"
      data-testid="movie-card"
    >
      <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <img
          src={movie.posterUrl}
          alt={movie.title}
          className="aspect-[2/3] w-full object-cover"
        />
      </div>
      <p className="mt-2 truncate text-sm text-zinc-300 group-hover:text-white">
        {movie.title}
      </p>
    </Link>
  );
}
