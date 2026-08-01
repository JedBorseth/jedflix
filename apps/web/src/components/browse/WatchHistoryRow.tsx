import { useMemo } from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@convex/_generated/api";
import { MovieCard } from "@/components/browse/MovieCard";
import { BookCard } from "@/components/browse/BookCard";
import { ContinueWatchingCard } from "@/components/browse/ContinueWatchingCard";
import { PosterRowSkeleton } from "@/components/ui/skeleton";
import { isVideoMediaType } from "@jedflix/shared";
import { getListenPath, getWorkDetails } from "@/lib/openlibrary";
import { catalogQueryKeys } from "@/lib/queryClient";
import { getMediaDetailsByIds } from "@/lib/tmdb";
import { getWatchHistoryItemKey } from "@/lib/watchHistoryKeys";
import {
  buildContinueListeningItems,
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

  const historyRecords: WatchHistoryRecord[] = useMemo(
    () =>
      (history ?? []).map((entry) => ({
        movieId: entry.movieId,
        workId: entry.workId,
        mediaType: entry.mediaType,
        progressSeconds: entry.progressSeconds,
        lastWatchedAt: entry.lastWatchedAt,
        season: entry.season,
        episode: entry.episode,
        fileIndex: entry.fileIndex,
        location: entry.location,
      })),
    [history],
  );

  const videoIds = useMemo(
    () =>
      historyRecords
        .filter(
          (entry) =>
            isVideoMediaType(entry.mediaType) && typeof entry.movieId === "number",
        )
        .map((entry) => ({
          mediaType: entry.mediaType as "movie" | "tv",
          movieId: entry.movieId as number,
        })),
    [historyRecords],
  );

  const audiobookIds = useMemo(
    () =>
      historyRecords
        .filter((entry) => entry.mediaType === "audiobook" && entry.workId)
        .map((entry) => entry.workId as string),
    [historyRecords],
  );

  const mediaQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.detailsByIds(videoIds),
    queryFn: () => getMediaDetailsByIds(videoIds),
    enabled: history !== undefined && videoIds.length > 0,
  });

  const booksQuery = useQuery({
    queryKey: ["continue-listening-books", audiobookIds],
    queryFn: async () => Promise.all(audiobookIds.map((id) => getWorkDetails(id))),
    enabled: history !== undefined && audiobookIds.length > 0 && mode === "continue",
  });

  const mediaItems = useMemo(() => {
    if (history !== undefined && videoIds.length === 0) {
      return [];
    }
    return mediaQuery.data;
  }, [history, videoIds.length, mediaQuery.data]);

  const continueItems = useMemo(
    () => buildContinueWatchingItems(historyRecords, mediaItems ?? []),
    [historyRecords, mediaItems],
  );

  const continueKeys = useMemo(
    () =>
      new Set(
        continueItems
          .filter((item) => item.movieId !== undefined)
          .map((item) => mediaKey(item.mediaType, item.movieId!)),
      ),
    [continueItems],
  );

  const recentItems = useMemo(
    () => buildRecentlyWatchedItems(historyRecords, mediaItems ?? [], continueKeys),
    [continueKeys, historyRecords, mediaItems],
  );

  const listeningItems = useMemo(
    () =>
      mode === "continue"
        ? buildContinueListeningItems(historyRecords, booksQuery.data ?? [])
        : [],
    [booksQuery.data, historyRecords, mode],
  );

  const videoItems = mode === "continue" ? continueItems : recentItems;
  const loading =
    history === undefined ||
    (videoIds.length > 0 && mediaItems === undefined) ||
    (mode === "continue" && audiobookIds.length > 0 && booksQuery.data === undefined);

  if (loading) {
    return (
      <section className="mb-8 px-4 md:px-12">
        <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
        <PosterRowSkeleton count={4} />
      </section>
    );
  }

  if (mediaQuery.isError && listeningItems.length === 0) {
    return null;
  }

  if (videoItems.length === 0 && listeningItems.length === 0) {
    return null;
  }

  return (
    <section className="mb-8 px-4 md:px-12">
      <h2 className="mb-3 text-lg font-semibold text-white md:text-xl">{title}</h2>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {videoItems.map((item) =>
          mode === "continue" ? (
            <ContinueWatchingCard key={getWatchHistoryItemKey(item)} item={item} />
          ) : (
            <MovieCard key={getWatchHistoryItemKey(item)} movie={item.media} />
          ),
        )}
        {listeningItems.map((item) => (
          <BookCard
            key={getWatchHistoryItemKey(item)}
            book={item.book}
            to={getListenPath(item.book.id)}
          />
        ))}
      </div>
    </section>
  );
}
