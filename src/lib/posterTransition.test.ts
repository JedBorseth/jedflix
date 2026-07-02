import { afterEach, describe, expect, test } from "bun:test";
import type { MediaItem } from "@/lib/types";
import {
  POSTER_VIEW_TRANSITION_NAME,
  applyDetailPosterTransition,
  beginDetailPosterTransitionTarget,
  clearPosterTransitionNames,
  countPosterTransitionNames,
  getDetailPosterTransitionStyle,
  getMediaNavigationState,
  isMovieLoadingForRoute,
  markPosterTransitionSource,
  resetPosterTransitionStateForTests,
  shouldApplyDetailPosterTransitionName,
  suppressDetailPosterTransitionTarget,
} from "./posterTransition";

const movie: MediaItem = {
  id: 1169516,
  mediaType: "movie",
  title: "Welcome to the Jungle",
  description: "An adventure.",
  posterUrl: "https://example.com/poster.jpg",
  backdropUrl: "https://example.com/backdrop.jpg",
  year: 2024,
  rating: "7.0 TMDB",
};

describe("posterTransition", () => {
  afterEach(() => {
    resetPosterTransitionStateForTests();
  });

  test("uses a shared poster transition name", () => {
    expect(POSTER_VIEW_TRANSITION_NAME).toBe("poster-expand");
  });

  test("markPosterTransitionSource names only the provided poster element", () => {
    const poster = document.createElement("img");
    markPosterTransitionSource(poster, movie);

    expect(poster.style.viewTransitionName).toBe("poster-expand");
  });

  test("markPosterTransitionSource clears existing poster transition names", () => {
    const existingPoster = document.createElement("img");
    existingPoster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;
    document.body.append(existingPoster);

    const clickedPoster = document.createElement("img");
    markPosterTransitionSource(clickedPoster, movie);

    expect(existingPoster.style.viewTransitionName).toBe("");
    expect(clickedPoster.style.viewTransitionName).toBe("poster-expand");

    existingPoster.remove();
    clickedPoster.remove();
  });

  test("clearPosterTransitionNames removes poster-expand from all images", () => {
    const firstPoster = document.createElement("img");
    const secondPoster = document.createElement("img");
    firstPoster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;
    secondPoster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;
    document.body.append(firstPoster, secondPoster);

    clearPosterTransitionNames();

    expect(firstPoster.style.viewTransitionName).toBe("");
    expect(secondPoster.style.viewTransitionName).toBe("");

    firstPoster.remove();
    secondPoster.remove();
  });

  test("getDetailPosterTransitionStyle only names the poster for card navigation", () => {
    expect(getDetailPosterTransitionStyle(false)).toEqual({ contain: "layout" });
    expect(getDetailPosterTransitionStyle(true)).toEqual({
      viewTransitionName: "poster-expand",
      contain: "layout",
    });
  });

  test("shouldApplyDetailPosterTransitionName respects suppression and pending destination", () => {
    beginDetailPosterTransitionTarget();
    expect(
      shouldApplyDetailPosterTransitionName(true, undefined, "movie", 1169516),
    ).toBe(true);

    markPosterTransitionSource(document.createElement("img"), movie);
    expect(
      shouldApplyDetailPosterTransitionName(true, undefined, "movie", 1169516),
    ).toBe(true);
    expect(
      shouldApplyDetailPosterTransitionName(true, undefined, "movie", 999),
    ).toBe(false);

    resetPosterTransitionStateForTests();
    beginDetailPosterTransitionTarget();
    suppressDetailPosterTransitionTarget();
    expect(
      shouldApplyDetailPosterTransitionName(true, undefined, "movie", 1169516),
    ).toBe(false);
  });

  test("isMovieLoadingForRoute treats stale loaded media as loading", () => {
    expect(isMovieLoadingForRoute(undefined, "movie", 1169516)).toBe(true);
    expect(isMovieLoadingForRoute(movie, "movie", 1169516)).toBe(false);
    expect(isMovieLoadingForRoute(movie, "movie", 999)).toBe(true);
    expect(isMovieLoadingForRoute(null, "movie", 1169516)).toBe(false);
  });

  test("applyDetailPosterTransition clears card names before naming the detail poster", () => {
    const cardPoster = document.createElement("img");
    const detailPoster = document.createElement("img");
    cardPoster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;
    document.body.append(cardPoster, detailPoster);

    applyDetailPosterTransition(detailPoster, true, "movie", 1169516);

    expect(cardPoster.style.viewTransitionName).toBe("");
    expect(detailPoster.style.viewTransitionName).toBe("poster-expand");
    expect(countPosterTransitionNames()).toBe(1);

    cardPoster.remove();
    detailPoster.remove();
  });

  test("applyDetailPosterTransition clears the name when disabled", () => {
    const poster = document.createElement("img");
    applyDetailPosterTransition(poster, true);
    expect(poster.style.viewTransitionName).toBe("poster-expand");

    applyDetailPosterTransition(poster, false);
    expect(poster.style.viewTransitionName).toBe("");
  });

  test("countPosterTransitionNames counts named poster images", () => {
    const poster = document.createElement("img");
    poster.style.viewTransitionName = POSTER_VIEW_TRANSITION_NAME;
    document.body.append(poster);

    expect(countPosterTransitionNames()).toBe(1);

    poster.remove();
  });

  test("getMediaNavigationState validates preview matches the route", () => {
    expect(getMediaNavigationState({ preview: movie }, "movie", 1169516)).toEqual({
      preview: movie,
    });
    expect(getMediaNavigationState({ preview: movie }, "tv", 1169516)).toBeNull();
    expect(getMediaNavigationState({ preview: movie }, "movie", 999)).toBeNull();
    expect(getMediaNavigationState(null, "movie", 1169516)).toBeNull();
  });
});
