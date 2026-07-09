import { shouldUsePosterTransition } from "@/lib/mobile";
import type { MediaItem, MediaType } from "@/lib/types";

export const POSTER_VIEW_TRANSITION_NAME = "poster-expand";

export type MediaNavigationState = {
  preview: MediaItem;
};

let detailPosterTransitionTarget = false;
let pendingPosterDestination: { mediaType: MediaType; id: number } | null = null;

export function beginDetailPosterTransitionTarget() {
  detailPosterTransitionTarget = true;
}

export function suppressDetailPosterTransitionTarget() {
  detailPosterTransitionTarget = false;
}

export function isMovieLoadingForRoute(
  movie: MediaItem | null | undefined,
  mediaType: MediaType,
  mediaId: number,
): boolean {
  if (movie === null) {
    return false;
  }

  if (movie === undefined) {
    return true;
  }

  return movie.id !== mediaId || movie.mediaType !== mediaType;
}

export function shouldApplyDetailPosterTransitionName(
  hasPreview: boolean,
  movie: MediaItem | null | undefined,
  mediaType: MediaType,
  mediaId: number,
): boolean {
  if (!hasPreview || !isMovieLoadingForRoute(movie, mediaType, mediaId)) {
    return false;
  }

  if (pendingPosterDestination) {
    return (
      pendingPosterDestination.mediaType === mediaType &&
      pendingPosterDestination.id === mediaId
    );
  }

  return detailPosterTransitionTarget;
}

export function clearPosterTransitionNames() {
  for (const element of document.querySelectorAll<HTMLElement>("img")) {
    if (element.style.viewTransitionName === POSTER_VIEW_TRANSITION_NAME) {
      element.style.viewTransitionName = "";
    }
  }
}

export function countPosterTransitionNames() {
  let count = 0;
  for (const element of document.querySelectorAll<HTMLElement>("img")) {
    if (element.style.viewTransitionName === POSTER_VIEW_TRANSITION_NAME) {
      count += 1;
    }
  }
  return count;
}

export function markPosterTransitionSource(
  poster: HTMLImageElement | null,
  media: MediaItem,
) {
  if (!poster || !shouldUsePosterTransition()) {
    return;
  }

  pendingPosterDestination = { mediaType: media.mediaType, id: media.id };
  suppressDetailPosterTransitionTarget();
  clearPosterTransitionNames();
  poster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;
}

export function applyDetailPosterTransition(
  poster: HTMLImageElement | null,
  enabled: boolean,
  mediaType?: MediaType,
  mediaId?: number,
) {
  if (!poster) {
    return;
  }

  poster.style.contain = "layout";

  if (!enabled || !shouldUsePosterTransition()) {
    poster.style.viewTransitionName = "";
    return;
  }

  clearPosterTransitionNames();
  poster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;

  if (
    pendingPosterDestination &&
    mediaType !== undefined &&
    mediaId !== undefined &&
    pendingPosterDestination.mediaType === mediaType &&
    pendingPosterDestination.id === mediaId
  ) {
    pendingPosterDestination = null;
  }
}

/** @deprecated Use applyDetailPosterTransition via a ref instead. */
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

export function resetPosterTransitionStateForTests() {
  detailPosterTransitionTarget = false;
  pendingPosterDestination = null;
}
