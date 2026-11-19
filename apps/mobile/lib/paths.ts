import type { MediaItem } from "@jedflix/shared";

export function getMobileMediaPath(item: Pick<MediaItem, "id" | "mediaType">) {
  return `/media/${item.mediaType}/${item.id}` as const;
}
