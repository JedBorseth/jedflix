import type { MediaItem, MediaType } from "@jedflix/shared";

export function getMobileMediaPath(item: Pick<MediaItem, "id" | "mediaType">) {
  return `/media/${item.mediaType}/${item.id}` as const;
}

export function getMobileWatchPath(mediaType: MediaType, mediaId: number) {
  return `/watch/${mediaType}/${mediaId}` as const;
}
