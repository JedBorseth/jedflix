import { useEffect, useState } from "react";
import { CastCard } from "./CastCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import type { CastMember, MediaType } from "@/lib/types";
import { getMediaCredits } from "@/lib/tmdb";

type CastRowProps = {
  mediaType: MediaType;
  mediaId: number;
};

export function CastRow({ mediaType, mediaId }: CastRowProps) {
  const [cast, setCast] = useState<CastMember[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCast(undefined);
    setError(null);

    getMediaCredits(mediaType, mediaId)
      .then((members) => {
        if (!cancelled) {
          setCast(members);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load cast");
          setCast([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mediaId, mediaType]);

  if (cast === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">Cast</h2>
        <PosterRowSkeleton />
      </section>
    );
  }

  if (error || cast.length === 0) {
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
