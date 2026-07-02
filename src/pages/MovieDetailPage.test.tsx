import { mock, test, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { MediaItem } from "@/lib/types";

const movie: MediaItem = {
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

mock.module("@/lib/tmdb", () => ({
  getMediaDetails: mock(() => new Promise(() => undefined)),
}));

import { MovieDetailPage } from "./MovieDetailPage";

function renderDetailPage(withPreview = false) {
  const router = createMemoryRouter(
    [{ path: "/movie/:mediaId", element: <MovieDetailPage mediaType="movie" /> }],
    {
      initialEntries: [
        {
          pathname: "/movie/123",
          state: withPreview ? { preview: movie } : null,
        },
      ],
    },
  );

  render(<RouterProvider router={router} />);
}

test("MovieDetailPage renders preview poster immediately for card navigation", async () => {
  renderDetailPage(true);

  const poster = await screen.findByRole("img", { name: "Neon Horizon" });
  expect(poster).toHaveAttribute("src", movie.posterUrl);
  expect(poster.style.viewTransitionName).toBe("poster-expand");
  expect(screen.getByText("Neon Horizon")).toBeInTheDocument();
});

test("MovieDetailPage shows loading state without preview data", () => {
  renderDetailPage(false);

  expect(screen.getByText("Loading...")).toBeInTheDocument();
});
