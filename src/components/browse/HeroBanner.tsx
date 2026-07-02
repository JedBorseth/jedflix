import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { Movie } from "@/lib/types";
import { formatDuration } from "@/lib/types";

type HeroBannerProps = {
  movie: Movie;
};

export function HeroBanner({ movie }: HeroBannerProps) {
  return (
    <section className="relative h-[70vh] min-h-[420px] w-full overflow-hidden">
      <img
        src={movie.backdropUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-black/30" />

      <div className="relative z-10 flex h-full max-w-2xl flex-col justify-end px-4 pb-16 pt-28 md:px-12">
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-red-500">
          Featured
        </p>
        <h1 className="mb-4 text-4xl font-bold text-white md:text-6xl">{movie.title}</h1>
        <p className="mb-4 line-clamp-3 text-sm text-zinc-200 md:text-base">
          {movie.description}
        </p>
        <div className="mb-6 flex flex-wrap gap-3 text-sm text-zinc-300">
          <span>{movie.year}</span>
          <span>{movie.rating}</span>
          <span>{formatDuration(movie.durationMinutes)}</span>
          <span>{movie.genre}</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-white text-black hover:bg-zinc-200">
            <Link to={`/watch/${movie._id}`}>Play</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="secondary"
            className="bg-zinc-500/40 text-white hover:bg-zinc-500/60"
          >
            <Link to={`/movie/${movie._id}`}>More Info</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
