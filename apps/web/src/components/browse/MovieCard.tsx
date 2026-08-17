import { useRef, type MouseEvent } from "react";
import { AppLink } from "@/components/layout/AppLink";
import { AddToJedsPicksButton } from "@/components/jedsPicks/AddToJedsPicksButton";
import { useHasRealDebridApiKey } from "@/hooks/useHasRealDebridApiKey";
import { blockDebridMediaNavigation } from "@/lib/debridAccess";
import type { MediaItem } from "@/lib/types";
import { getMediaDetailPath } from "@/lib/tmdb";
import { markPosterTransitionSource } from "@/lib/posterTransition";
import { cn } from "@/lib/utils";

type MovieCardProps = {
  movie: MediaItem;
};

export function MovieCard({ movie }: MovieCardProps) {
  const posterRef = useRef<HTMLImageElement>(null);
  const detailPath = getMediaDetailPath(movie);
  const hasDebridKey = useHasRealDebridApiKey();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (blockDebridMediaNavigation()) {
      event.preventDefault();
      return;
    }
    markPosterTransitionSource(posterRef.current, movie);
  }

  return (
    <div className="group relative w-36 shrink-0 snap-start md:w-44">
      <AppLink
        to={detailPath}
        state={{ preview: movie }}
        onClick={handleClick}
        aria-disabled={!hasDebridKey}
        className={cn(
          "block",
          !hasDebridKey && "cursor-not-allowed opacity-50",
        )}
        data-testid="movie-card"
      >
        <div className="overflow-hidden rounded-md transition duration-300 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-black/50">
          <img
            ref={posterRef}
            src={movie.posterUrl}
            alt={movie.title}
            loading="lazy"
            decoding="async"
            className="aspect-[2/3] w-full object-cover [contain:layout]"
          />
        </div>
        <p className="mt-2 truncate text-sm text-zinc-300 group-hover:text-white">
          {movie.title}
        </p>
      </AppLink>
      <AddToJedsPicksButton
        item={{
          kind: movie.mediaType === "tv" ? "tv" : "movie",
          movieId: movie.id,
        }}
      />
    </div>
  );
}
