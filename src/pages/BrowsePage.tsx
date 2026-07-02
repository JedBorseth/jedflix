import { useEffect, useState } from "react";
import { Authenticated } from "convex/react";
import { HeroBanner } from "@/components/browse/HeroBanner";
import { MovieRow } from "@/components/browse/MovieRow";
import { WatchHistoryRow } from "@/components/browse/WatchHistoryRow";
import { Navbar } from "@/components/layout/Navbar";
import type { MediaItem, MediaType } from "@/lib/types";
import { discoverMedia, getTrendingMedia, mediaRows } from "@/lib/tmdb";

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
      ? mediaRows.tv
      : mediaType === "movie"
        ? mediaRows.movie
        : [...mediaRows.movie.slice(0, 3), ...mediaRows.tv.slice(0, 3)];

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Navbar />
      {heroMovie ? (
        <HeroBanner movie={heroMovie} />
      ) : error ? (
        <div className="flex h-[50vh] items-center justify-center px-4 pt-20 text-center">
          <p className="text-zinc-400">{error}</p>
        </div>
      ) : (
        <div className="flex h-[50vh] items-center justify-center pt-20">
          <p className="text-zinc-400">Loading featured title...</p>
        </div>
      )}

      <div className="-mt-16 relative z-10 pb-16">
        <div className="px-4 pb-6 md:px-12">
          <h1 className="sr-only">{pageTitle}</h1>
        </div>
        {mediaType === "all" ? (
          <Authenticated>
            <WatchHistoryRow title="Continue Watching" mode="continue" />
            <WatchHistoryRow title="Recently Watched" mode="recent" />
          </Authenticated>
        ) : null}
        {rows.map((row) => (
          <MovieRow
            key={`${row.title}-${mediaType}`}
            title={row.title}
            mediaType={row.title.includes("Shows") || mediaType === "tv" ? "tv" : "movie"}
            genreId={row.genreId}
          />
        ))}
      </div>
    </div>
  );
}
