import type { MediaItem, MediaType } from "@/lib/types";
import { mediaKey } from "@jedflix/shared";

export type WatchHistoryRecord = {
  movieId: number;
  mediaType: MediaType;
  progressSeconds: number;
  lastWatchedAt: number;
  season?: number;
  episode?: number;
};

export type WatchHistoryItem = WatchHistoryRecord & {
  media: MediaItem;
};

export function buildContinueWatchingItems(
  history: WatchHistoryRecord[],
  mediaItems: MediaItem[],
): WatchHistoryItem[] {
  const mediaByKey = new Map(
    mediaItems.map((media) => [mediaKey(media.mediaType, media.id), media]),
  );

  return history
    .map((entry) => {
      const media = mediaByKey.get(mediaKey(entry.mediaType, entry.movieId));
      if (!media) {
        return null;
      }

      if (entry.progressSeconds < 30) {
        return null;
      }

      const totalSeconds = (media.durationMinutes ?? 90) * 60;
      if (entry.progressSeconds >= totalSeconds * 0.9) {
        return null;
      }

      return { ...entry, media };
    })
    .filter((item): item is WatchHistoryItem => item !== null)
    .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
    .slice(0, 12);
}

export function buildRecentlyWatchedItems(
  history: WatchHistoryRecord[],
  mediaItems: MediaItem[],
  continueWatchingKeys: Set<string>,
): WatchHistoryItem[] {
  const mediaByKey = new Map(
    mediaItems.map((media) => [mediaKey(media.mediaType, media.id), media]),
  );

  return history
    .map((entry) => {
      const key = mediaKey(entry.mediaType, entry.movieId);
      if (continueWatchingKeys.has(key)) {
        return null;
      }

      const media = mediaByKey.get(key);
      if (!media) {
        return null;
      }

      return { ...entry, media };
    })
    .filter((item): item is WatchHistoryItem => item !== null)
    .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
    .slice(0, 12);
}

export { mediaKey };
