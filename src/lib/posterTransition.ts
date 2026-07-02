import type { MediaItem } from "@/lib/types";

export const POSTER_VIEW_TRANSITION_NAME = "poster-expand";

export type MediaNavigationState = {
  preview: MediaItem;
};

export function markPosterTransitionSource(poster: HTMLImageElement | null) {
  if (!poster) {
    return;
  }

  poster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;
}

export function getDetailPosterTransitionStyle(enabled: boolean) {
  if (!enabled) {
    return { contain: "layout" as const };
  }

  return {
    viewTransitionName: POSTER_VIEW_TRANSITION_NAME,
    contain: "layout" as const,
  };
}

export function getMediaNavigationState(
  state: unknown,
  mediaType: MediaItem["mediaType"],
  mediaId: number,
): MediaNavigationState | null {
  if (!state || typeof state !== "object" || !("preview" in state)) {
    return null;
  }

  const preview = (state as MediaNavigationState).preview;
  if (preview.id !== mediaId || preview.mediaType !== mediaType) {
    return null;
  }

  return { preview };
}
