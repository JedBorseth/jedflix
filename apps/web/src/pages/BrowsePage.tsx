import { useQuery } from "@tanstack/react-query";
import { Authenticated } from "convex/react";
import { HeroBanner } from "@/components/browse/HeroBanner";
import { LetterboxdRow } from "@/components/browse/LetterboxdRow";
import { MovieRow } from "@/components/browse/MovieRow";
import { WatchHistoryRow } from "@/components/browse/WatchHistoryRow";
import { Navbar } from "@/components/layout/Navbar";
import { HeroBannerSkeleton } from "@/components/ui/skeleton";
import { catalogQueryKeys } from "@/lib/queryClient";
import type { MediaType } from "@/lib/types";
import {
  buildHomeCatalogRows,
  buildMediaCatalogRows,
  discoverMedia,
  getTrendingMedia,
} from "@/lib/tmdb";

type BrowsePageProps = {
  mediaType?: MediaType | "all";
};

export function BrowsePage({ mediaType = "all" }: BrowsePageProps) {
  const pageTitle =
    mediaType === "movie" ? "Movies" : mediaType === "tv" ? "Shows" : "Home";

  const heroQuery = useQuery({
    queryKey:
      mediaType === "all"
        ? catalogQueryKeys.tmdb.trending()
        : catalogQueryKeys.tmdb.discover(mediaType),
    queryFn: () =>
      mediaType === "all" ? getTrendingMedia() : discoverMedia(mediaType),
  });

  const heroMovie = heroQuery.data?.[0];
  const error = heroQuery.error
    ? heroQuery.error instanceof Error
      ? heroQuery.error.message
      : "Unable to load TMDB titles"
    : null;

  const rows =
    mediaType === "all"
      ? buildHomeCatalogRows()
      : buildMediaCatalogRows(mediaType);

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
            key={`${row.type}-${row.title}-${row.watchProviderId ?? row.genreId ?? "popular"}`}
            title={row.title}
            mediaType={row.type}
            genreId={row.genreId}
            watchProviderId={row.watchProviderId}
          />
        ))}
      </div>
    </div>
  );
}
