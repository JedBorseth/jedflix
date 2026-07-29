import { useEffect, useState } from "react";
import { Authenticated } from "convex/react";
import { HeroBanner } from "@/components/browse/HeroBanner";
import { LetterboxdRow } from "@/components/browse/LetterboxdRow";
import { MovieRow } from "@/components/browse/MovieRow";
import { WatchHistoryRow } from "@/components/browse/WatchHistoryRow";
import { Navbar } from "@/components/layout/Navbar";
import { HeroBannerSkeleton } from "@/components/ui/skeleton";
import type { MediaItem, MediaType } from "@/lib/types";
import { discoverMedia, getTrendingMedia, HOME_ROW_LIMIT, mediaRows } from "@/lib/tmdb";

type BrowsePageProps = {
  mediaType?: MediaType | "all";
};

export function BrowsePage({ mediaType = "all" }: BrowsePageProps) {
  const [heroMovie, setHeroMovie] = useState<MediaItem>();
  const [error, setError] = useState<string | null>(null);
  const pageTitle =
    mediaType === "movie" ? "Movies" : mediaType === "tv" ? "Shows" : "Home";

  useEffect(() => {
    let cancelled = false;
    setHeroMovie(undefined);
    setError(null);

    const request =
      mediaType === "all" ? getTrendingMedia() : discoverMedia(mediaType);

    request
      .then((items) => {
        if (!cancelled) {
          setHeroMovie(items[0]);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load TMDB titles");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mediaType]);

  const rows =
    mediaType === "tv"
      ? mediaRows.tv.map((row) => ({ ...row, type: "tv" as const }))
      : mediaType === "movie"
        ? mediaRows.movie.map((row) => ({ ...row, type: "movie" as const }))
        : [
            ...mediaRows.movie.slice(0, HOME_ROW_LIMIT).map((row) => ({
              ...row,
              type: "movie" as const,
            })),
            ...mediaRows.tv.slice(0, HOME_ROW_LIMIT).map((row) => ({
              ...row,
              type: "tv" as const,
            })),
          ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      {heroMovie ? (
        <HeroBanner movie={heroMovie} />
      ) : error ? (
        <div className="pt-navbar flex h-[50vh] items-center justify-center px-4 text-center">
          <p className="text-zinc-400">{error}</p>
        </div>
      ) : (
        <HeroBannerSkeleton />
      )}

      <div className="-mt-16 relative z-10 pb-24 md:pb-16">
        <div className="px-4 pb-6 md:px-12">
          <h1 className="sr-only">{pageTitle}</h1>
        </div>
        {mediaType === "all" ? (
          <>
            <Authenticated>
              <WatchHistoryRow title="Continue Watching" mode="continue" />
              <WatchHistoryRow title="Recently Watched" mode="recent" />
            </Authenticated>
            <LetterboxdRow title="From Letterboxd" />
          </>
        ) : null}
        {rows.map((row) => (
          <MovieRow
            key={`${row.type}-${row.title}`}
            title={row.title}
            mediaType={row.type}
            genreId={row.genreId}
          />
        ))}
      </div>
    </div>
  );
}
