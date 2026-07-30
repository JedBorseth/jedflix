import { useQuery } from "@tanstack/react-query";
import { MovieCard } from "./MovieCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { catalogQueryKeys } from "@/lib/queryClient";
import type { MediaType } from "@/lib/types";
import { getSimilarMedia } from "@/lib/tmdb";

type SimilarTitlesRowProps = {
  mediaType: MediaType;
  mediaId: number;
};

export function SimilarTitlesRow({ mediaType, mediaId }: SimilarTitlesRowProps) {
  const rowTitle = mediaType === "movie" ? "More Like This" : "Similar Shows";
  const titlesQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.similar(mediaType, mediaId),
    queryFn: () => getSimilarMedia(mediaType, mediaId),
  });

  const titles = titlesQuery.data;

  if (titles === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{rowTitle}</h2>
        <PosterRowSkeleton />
      </section>
    );
  }

  if (titlesQuery.isError || titles.length === 0) {
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
