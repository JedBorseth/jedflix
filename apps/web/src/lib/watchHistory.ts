import type { MediaItem, MediaType } from "@/lib/types";
import { isBookMediaType, mediaKey } from "@jedflix/shared";

export type WatchHistoryRecord = {
  movieId?: number;
  workId?: string;
  mediaType: MediaType;
  progressSeconds: number;
  lastWatchedAt: number;
  season?: number;
  episode?: number;
  fileIndex?: number;
  location?: string;
};

export type WatchHistoryItem = WatchHistoryRecord & {
  media: MediaItem;
};

export type BookHistoryItem = WatchHistoryRecord & {
  book: {
    id: string;
    title: string;
    coverUrl: string;
    coverFullUrl?: string;
    authors: string[];
  };
};

function recordKey(entry: WatchHistoryRecord): string | null {
  if (isBookMediaType(entry.mediaType)) {
    return entry.workId ? mediaKey(entry.mediaType, entry.workId) : null;
  }
  return entry.movieId !== undefined ? mediaKey(entry.mediaType, entry.movieId) : null;
}

export function buildContinueWatchingItems(
  history: WatchHistoryRecord[],
  mediaItems: MediaItem[],
): WatchHistoryItem[] {
  const mediaByKey = new Map(
    mediaItems.map((media) => [mediaKey(media.mediaType, media.id), media]),
  );

  return history
    .map((entry) => {
      if (isBookMediaType(entry.mediaType) || entry.movieId === undefined) {
        return null;
      }
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
      if (isBookMediaType(entry.mediaType) || entry.movieId === undefined) {
        return null;
      }
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

export function buildContinueListeningItems(
  history: WatchHistoryRecord[],
  books: BookHistoryItem["book"][],
): BookHistoryItem[] {
  const booksById = new Map(books.map((book) => [book.id, book]));
  return history
    .map((entry) => {
      if (entry.mediaType !== "audiobook" || !entry.workId) {
        return null;
      }
      if (entry.progressSeconds < 15 && (entry.fileIndex ?? 0) === 0) {
        return null;
      }
      const book = booksById.get(entry.workId);
      if (!book) {
        return null;
      }
      return { ...entry, book };
    })
    .filter((item): item is BookHistoryItem => item !== null)
    .sort((a, b) => b.lastWatchedAt - a.lastWatchedAt)
    .slice(0, 12);
}

export { mediaKey, recordKey };
