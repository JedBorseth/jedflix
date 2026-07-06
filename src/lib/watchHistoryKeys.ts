import type { WatchHistoryItem } from "@/lib/watchHistory";
import { mediaKey } from "@/lib/watchHistory";

export function getWatchHistoryItemKey(item: WatchHistoryItem) {
  return mediaKey(item.mediaType, item.movieId);
}
