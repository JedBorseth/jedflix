import { test, expect } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { MovieCard } from "./MovieCard";
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

function renderMovieCard() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <MovieCard movie={movie} />
            <MovieCard movie={movie} />
          </>
        ),
      },
      { path: "/movie/:mediaId", element: <div>Detail</div> },
    ],
    { initialEntries: ["/"] },
  );

  render(<RouterProvider router={router} />);
}

test("MovieCard renders title from props", () => {
  renderMovieCard();

  expect(screen.getAllByText("Neon Horizon")).toHaveLength(2);
  expect(screen.getAllByTestId("movie-card")).toHaveLength(2);
});

test("MovieCard does not assign view-transition-name by default", () => {
  renderMovieCard();

  const images = screen.getAllByRole("img");
  expect(images).toHaveLength(2);
  expect(images[0]?.style.viewTransitionName || "").toBe("");
  expect(images[1]?.style.viewTransitionName || "").toBe("");
});

test("MovieCard assigns transition name only to the clicked poster", () => {
  renderMovieCard();

  const cards = screen.getAllByTestId("movie-card");
  const images = screen.getAllByRole("img");

  fireEvent.click(cards[1]!);

  expect(images[0]?.style.viewTransitionName || "").toBe("");
  expect(images[1]?.style.viewTransitionName).toBe("poster-expand");
});
