import { useMemo } from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@convex/_generated/api";
import { MovieCard } from "@/components/browse/MovieCard";
import { ContinueWatchingCard } from "@/components/browse/ContinueWatchingCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { catalogQueryKeys } from "@/lib/queryClient";
import { getMediaDetailsByIds } from "@/lib/tmdb";
import { getWatchHistoryItemKey } from "@/lib/watchHistoryKeys";
import {
  buildContinueWatchingItems,
  buildRecentlyWatchedItems,
  mediaKey,
  type WatchHistoryRecord,
} from "@/lib/watchHistory";

type WatchHistoryRowProps = {
  title: string;
  mode: "continue" | "recent";
};

export function WatchHistoryRow({ title, mode }: WatchHistoryRowProps) {
  const history = useConvexQuery(api.watchHistory.getForUser);

  const historyIds = useMemo(
    () =>
      (history ?? []).map((entry) => ({
        mediaType: entry.mediaType,
        movieId: entry.movieId,
      })),
    [history],
  );

  const mediaQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.detailsByIds(historyIds),
    queryFn: () => getMediaDetailsByIds(historyIds),
    enabled: history !== undefined && historyIds.length > 0,
  });

  const mediaItems = useMemo(() => {
    if (history !== undefined && historyIds.length === 0) {
      return [];
    }
    return mediaQuery.data;
  }, [history, historyIds.length, mediaQuery.data]);

  const historyRecords: WatchHistoryRecord[] = useMemo(
    () =>
      (history ?? []).map((entry) => ({
        movieId: entry.movieId,
        mediaType: entry.mediaType,
        progressSeconds: entry.progressSeconds,
        lastWatchedAt: entry.lastWatchedAt,
      })),
    [history],
  );

  const continueItems = useMemo(
    () => buildContinueWatchingItems(historyRecords, mediaItems ?? []),
    [historyRecords, mediaItems],
  );

  const continueKeys = useMemo(
    () => new Set(continueItems.map((item) => mediaKey(item.mediaType, item.movieId))),
    [continueItems],
  );

  const recentItems = useMemo(
    () => buildRecentlyWatchedItems(historyRecords, mediaItems ?? [], continueKeys),
    [continueKeys, historyRecords, mediaItems],
  );

  const items = mode === "continue" ? continueItems : recentItems;

  if (history === undefined || mediaItems === undefined) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
        <PosterRowSkeleton count={4} />
      </section>
    );
  }

  if (mediaQuery.isError || items.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {items.map((item) =>
          mode === "continue" ? (
            <ContinueWatchingCard key={getWatchHistoryItemKey(item)} item={item} />
          ) : (
            <MovieCard key={getWatchHistoryItemKey(item)} movie={item.media} />
          ),
        )}
      </div>
    </section>
  );
}
