import { useQuery } from "@tanstack/react-query";
import { CastCard } from "./CastCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { catalogQueryKeys } from "@/lib/queryClient";
import type { MediaType } from "@/lib/types";
import { getMediaCredits } from "@/lib/tmdb";

type CastRowProps = {
  mediaType: MediaType;
  mediaId: number;
};

export function CastRow({ mediaType, mediaId }: CastRowProps) {
  const castQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.credits(mediaType, mediaId),
    queryFn: () => getMediaCredits(mediaType, mediaId),
  });

  const cast = castQuery.data;

  if (cast === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">Cast</h2>
        <PosterRowSkeleton />
      </section>
    );
  }

  if (castQuery.isError || cast.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">Cast</h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {cast.map((member) => (
          <CastCard key={member.id} member={member} />
        ))}
      </div>
    </section>
  );
}
