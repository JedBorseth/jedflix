import { useEffect, useState } from "react";
import { MovieCard } from "./MovieCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import type { MediaItem, MediaType } from "@/lib/types";
import { getSimilarMedia } from "@/lib/tmdb";

type SimilarTitlesRowProps = {
  mediaType: MediaType;
  mediaId: number;
};

export function SimilarTitlesRow({ mediaType, mediaId }: SimilarTitlesRowProps) {
  const [titles, setTitles] = useState<MediaItem[]>();
  const [error, setError] = useState<string | null>(null);
  const rowTitle = mediaType === "movie" ? "More Like This" : "Similar Shows";

  useEffect(() => {
    let cancelled = false;
    setTitles(undefined);
    setError(null);

    getSimilarMedia(mediaType, mediaId)
      .then((items) => {
        if (!cancelled) {
          setTitles(items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load suggestions");
          setTitles([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mediaId, mediaType]);

  if (titles === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{rowTitle}</h2>
        <PosterRowSkeleton />
      </section>
    );
  }

  if (error) {
    return null;
  }

  if (titles.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{rowTitle}</h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {titles.map((movie) => (
          <MovieCard key={`${movie.mediaType}-${movie.id}`} movie={movie} />
        ))}
      </div>
    </section>
  );
}
