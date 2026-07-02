import { describe, expect, test } from "bun:test";
import type { MediaItem } from "@/lib/types";
import {
  POSTER_VIEW_TRANSITION_NAME,
  getDetailPosterTransitionStyle,
  getMediaNavigationState,
  markPosterTransitionSource,
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
  test("uses a shared poster transition name", () => {
    expect(POSTER_VIEW_TRANSITION_NAME).toBe("poster-expand");
  });

  test("markPosterTransitionSource names only the provided poster element", () => {
    const poster = document.createElement("img");
    markPosterTransitionSource(poster);

    expect(poster.style.viewTransitionName).toBe("poster-expand");
  });

  test("getDetailPosterTransitionStyle only names the poster for card navigation", () => {
    expect(getDetailPosterTransitionStyle(false)).toEqual({ contain: "layout" });
    expect(getDetailPosterTransitionStyle(true)).toEqual({
      viewTransitionName: "poster-expand",
      contain: "layout",
    });
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
