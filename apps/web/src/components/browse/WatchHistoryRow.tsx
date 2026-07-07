import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { MovieCard } from "@/components/browse/MovieCard";
import { ContinueWatchingCard } from "@/components/browse/ContinueWatchingCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { getMediaDetailsByIds } from "@/lib/tmdb";
import type { MediaItem } from "@/lib/types";
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
  const history = useQuery(api.watchHistory.getForUser);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!history || history.length === 0) {
      setMediaItems([]);
      return;
    }

    let cancelled = false;
    setMediaItems(undefined);
    setError(null);

    getMediaDetailsByIds(history)
      .then((items) => {
        if (!cancelled) {
          setMediaItems(items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Unable to load titles");
          setMediaItems([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [history]);

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

  if (error || items.length === 0) {
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
