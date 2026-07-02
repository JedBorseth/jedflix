import { afterEach, mock, test, expect } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { MediaItem } from "@/lib/types";
import {
  POSTER_VIEW_TRANSITION_NAME,
  applyDetailPosterTransition,
  countPosterTransitionNames,
  markPosterTransitionSource,
  resetPosterTransitionStateForTests,
  shouldApplyDetailPosterTransitionName,
} from "@/lib/posterTransition";

const currentMovie: MediaItem = {
  id: 863,
  mediaType: "movie",
  title: "Toy Story 2",
  description: "Andy heads off to Cowboy Camp.",
  posterUrl: "https://image.tmdb.org/t/p/w500/toy-story-2.jpg",
  backdropUrl: "https://image.tmdb.org/t/p/w1280/toy-story-2-bg.jpg",
  genre: "Animation",
  year: 1999,
  durationMinutes: 92,
  rating: "G",
};

const similarMovie: MediaItem = {
  id: 301528,
  mediaType: "movie",
  title: "Toy Story 4",
  description: "Woody has always been confident about his place in the world.",
  posterUrl: "https://image.tmdb.org/t/p/w500/toy-story-4.jpg",
  backdropUrl: "https://image.tmdb.org/t/p/w1280/toy-story-4-bg.jpg",
  genre: "Animation",
  year: 2019,
  durationMinutes: 100,
  rating: "G",
};

const thirdMovie: MediaItem = {
  id: 129,
  mediaType: "movie",
  title: "Toy Story 3",
  description: "Woody and Buzz lead a rescue mission.",
  posterUrl: "https://image.tmdb.org/t/p/w500/toy-story-3.jpg",
  backdropUrl: "https://image.tmdb.org/t/p/w1280/toy-story-3-bg.jpg",
  genre: "Animation",
  year: 2010,
  durationMinutes: 103,
  rating: "G",
};

const neonHorizon: MediaItem = {
  id: 123,
  mediaType: "movie",
  title: "Neon Horizon",
  description: "A sci-fi adventure.",
  posterUrl: "https://picsum.photos/seed/neon-horizon/300/450",
  backdropUrl: "https://picsum.photos/seed/neon-horizon-bg/1920/1080",
  genre: "Sci-Fi",
  year: 2024,
  durationMinutes: 128,
  rating: "PG-13",
};

mock.module("convex/react", () => ({
  useQuery: () => undefined,
  Authenticated: ({ children }: { children: React.ReactNode }) => null,
  Unauthenticated: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const getMediaDetails = mock(
  (_mediaType: "movie" | "tv", mediaId: number) =>
    new Promise<MediaItem>(() => undefined),
);
const getSimilarMedia = mock(
  (_mediaType: "movie" | "tv", _mediaId: number) => Promise.resolve<MediaItem[]>([]),
);

mock.module("@/lib/tmdb", () => ({
  getMediaDetails,
  getSimilarMedia,
}));

import { MovieDetailPage } from "./MovieDetailPage";

afterEach(() => {
  resetPosterTransitionStateForTests();
  getMediaDetails.mockReset();
  getMediaDetails.mockImplementation(
    (_mediaType: "movie" | "tv", _mediaId: number) =>
      new Promise<MediaItem>(() => undefined),
  );
  getSimilarMedia.mockReset();
  getSimilarMedia.mockImplementation(() => Promise.resolve([]));
});

function mockLoadedDetailResponses() {
  getMediaDetails.mockImplementation((_mediaType, mediaId) => {
    if (mediaId === currentMovie.id) {
      return Promise.resolve(currentMovie);
    }
    if (mediaId === similarMovie.id) {
      return Promise.resolve(similarMovie);
    }
    if (mediaId === thirdMovie.id) {
      return Promise.resolve(thirdMovie);
    }
    return Promise.reject(new Error("Unknown media id"));
  });

  getSimilarMedia.mockImplementation((_mediaType, mediaId) => {
    if (mediaId === currentMovie.id) {
      return Promise.resolve([similarMovie]);
    }
    if (mediaId === similarMovie.id) {
      return Promise.resolve([thirdMovie]);
    }
    return Promise.resolve([]);
  });
}

function renderDetailPage(options?: {
  preview?: MediaItem;
  pathname?: string;
}) {
  const preview = options?.preview;
  const pathname = options?.pathname ?? `/movie/${preview?.id ?? currentMovie.id}`;

  const router = createMemoryRouter(
    [{ path: "/movie/:mediaId", element: <MovieDetailPage mediaType="movie" /> }],
    {
      initialEntries: [
        {
          pathname,
          state: preview ? { preview } : null,
        },
      ],
    },
  );

  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

test("MovieDetailPage renders preview poster immediately for card navigation", async () => {
  renderDetailPage({ preview: neonHorizon, pathname: "/movie/123" });

  const poster = await screen.findByRole("img", { name: "Neon Horizon" });
  expect(poster).toHaveAttribute("src", neonHorizon.posterUrl);
  expect(poster.style.viewTransitionName).toBe("poster-expand");
  expect(screen.getByText("Neon Horizon")).toBeInTheDocument();
});

test("MovieDetailPage shows loading state without preview data", () => {
  renderDetailPage();

  expect(document.querySelectorAll("[aria-hidden='true'].animate-pulse").length).toBeGreaterThan(0);
});

test("clicking More Like This keeps a single poster-expand name during rerender", async () => {
  getSimilarMedia.mockImplementation(() => Promise.resolve([similarMovie]));

  const { router, rerender } = renderDetailPage({ preview: currentMovie });

  const detailPoster = await screen.findByRole("img", { name: "Toy Story 2" });
  expect(detailPoster.className).toContain("w-56");
  expect(countPosterTransitionNames()).toBe(1);

  const similarCard = await screen.findByRole("link", { name: /Toy Story 4/i });
  const similarPoster = similarCard.querySelector("img");
  expect(similarPoster).not.toBeNull();
  similarCard.addEventListener("click", (event) => {
    event.preventDefault();
  });

  fireEvent.click(similarCard);

  expect(countPosterTransitionNames()).toBe(1);
  expect(detailPoster.style.viewTransitionName).toBe("");
  expect(similarPoster?.style.viewTransitionName).toBe(POSTER_VIEW_TRANSITION_NAME);

  await act(async () => {
    rerender(<RouterProvider router={router} />);
  });

  expect(countPosterTransitionNames()).toBe(1);
  expect(detailPoster.style.viewTransitionName).toBe("");
  expect(similarPoster?.style.viewTransitionName).toBe(POSTER_VIEW_TRANSITION_NAME);
});

test("navigating from a loaded detail page to More Like This keeps one poster-expand name", async () => {
  getMediaDetails.mockImplementation(() => Promise.resolve(currentMovie));
  getSimilarMedia.mockImplementation(() => Promise.resolve([similarMovie]));

  renderDetailPage({ preview: currentMovie });

  const detailPoster = await screen.findByRole("img", { name: "Toy Story 2" });
  await waitFor(() => {
    expect(detailPoster.style.viewTransitionName).toBe("");
  });

  const similarCard = await screen.findByRole("link", { name: /Toy Story 4/i });
  const similarPoster = similarCard.querySelector("img");
  expect(similarPoster).not.toBeNull();
  similarCard.addEventListener("click", (event) => {
    event.preventDefault();
  });

  fireEvent.click(similarCard);

  expect(countPosterTransitionNames()).toBe(1);
  expect(detailPoster.style.viewTransitionName).toBe("");
  expect(similarPoster?.style.viewTransitionName).toBe(POSTER_VIEW_TRANSITION_NAME);
});

test("second similar-title navigation keeps one poster-expand name after route change", async () => {
  mockLoadedDetailResponses();

  const router = createMemoryRouter(
    [{ path: "/movie/:mediaId", element: <MovieDetailPage mediaType="movie" /> }],
    {
      initialEntries: [
        {
          pathname: `/movie/${similarMovie.id}`,
          state: { preview: similarMovie },
        },
      ],
    },
  );

  render(<RouterProvider router={router} />);

  await waitFor(() => {
    expect(screen.getByRole("link", { name: /Toy Story 3/i })).toBeInTheDocument();
  });

  const detailPoster = screen.getByRole("img", { name: "Toy Story 4" });
  const similarCard = screen.getByRole("link", { name: /Toy Story 3/i });
  const similarPoster = similarCard.querySelector("img");
  expect(similarPoster).not.toBeNull();

  markPosterTransitionSource(similarPoster, thirdMovie);
  expect(countPosterTransitionNames()).toBe(1);

  applyDetailPosterTransition(
    detailPoster,
    shouldApplyDetailPosterTransitionName(
      true,
      similarMovie,
      "movie",
      thirdMovie.id,
    ),
    "movie",
    thirdMovie.id,
  );

  expect(countPosterTransitionNames()).toBe(1);
  expect(similarPoster?.style.viewTransitionName).toBe("");
  expect(detailPoster.style.viewTransitionName).toBe(POSTER_VIEW_TRANSITION_NAME);

  await act(async () => {
    await router.navigate({
      pathname: `/movie/${thirdMovie.id}`,
      state: { preview: thirdMovie },
    });
  });

  expect(countPosterTransitionNames()).toBeLessThanOrEqual(1);
});
