import type { MediaType } from "./types";
import { isBookMediaType } from "./types";

export type WatchHistoryKeyInput = {
  mediaType: MediaType;
  movieId?: number;
  workId?: string;
};

export function mediaKey(mediaType: MediaType, id: number | string) {
  return `${mediaType}-${id}`;
}

export function getWatchHistoryItemKey(item: WatchHistoryKeyInput) {
  if (isBookMediaType(item.mediaType)) {
    if (!item.workId) {
      throw new Error(`workId is required for ${item.mediaType}`);
    }
    return mediaKey(item.mediaType, item.workId);
  }
  if (item.movieId === undefined) {
    throw new Error(`movieId is required for ${item.mediaType}`);
  }
  return mediaKey(item.mediaType, item.movieId);
}

export function getMediaIdentityKey(item: WatchHistoryKeyInput) {
  return getWatchHistoryItemKey(item);
}
