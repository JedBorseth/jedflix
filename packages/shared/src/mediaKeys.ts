import type { MediaType } from "./types";

export type WatchHistoryKeyInput = {
  mediaType: MediaType;
  movieId: number;
};

export function mediaKey(mediaType: MediaType, movieId: number) {
  return `${mediaType}-${movieId}`;
}

export function getWatchHistoryItemKey(item: WatchHistoryKeyInput) {
  return mediaKey(item.mediaType, item.movieId);
}
