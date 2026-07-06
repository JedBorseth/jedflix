import { useRef, type MouseEvent } from "react";
import { AppLink } from "@/components/layout/AppLink";
import type { MediaItem } from "@/lib/types";
import { getMediaDetailPath } from "@/lib/tmdb";
import { markPosterTransitionSource } from "@/lib/posterTransition";

type MovieCardProps = {
  movie: MediaItem;
};

export function MovieCard({ movie }: MovieCardProps) {
  const posterRef = useRef<HTMLImageElement>(null);
  const detailPath = getMediaDetailPath(movie);

  function handleClick(_event: MouseEvent<HTMLAnchorElement>) {
    markPosterTransitionSource(posterRef.current, movie);
  }

  return (
    <AppLink
      to={detailPath}
      state={{ preview: movie }}
      onClick={handleClick}
      className="group relative block w-36 shrink-0 snap-start md:w-44"
      data-testid="movie-card"
    >
      <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
        <img
          ref={posterRef}
          src={movie.posterUrl}
          alt={movie.title}
          className="aspect-[2/3] w-full object-cover [contain:layout]"
        />
      </div>
      <p className="mt-2 truncate text-sm text-zinc-300 group-hover:text-white">
        {movie.title}
      </p>
    </AppLink>
  );
}
