import { test, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MovieCard } from "./MovieCard";
import type { Movie } from "@/lib/types";

const movie: Movie = {
  _id: "movie123" as Movie["_id"],
  _creationTime: Date.now(),
  title: "Neon Horizon",
  description: "A sci-fi adventure.",
  posterUrl: "https://picsum.photos/seed/neon-horizon/300/450",
  backdropUrl: "https://picsum.photos/seed/neon-horizon-bg/1920/1080",
  genre: "Sci-Fi",
  year: 2024,
  durationMinutes: 128,
  rating: "PG-13",
  featured: true,
};

test("MovieCard renders title from props", () => {
  render(
    <MemoryRouter>
      <MovieCard movie={movie} />
    </MemoryRouter>,
  );

  expect(screen.getByText("Neon Horizon")).toBeInTheDocument();
  expect(screen.getByTestId("movie-card")).toBeInTheDocument();
});
