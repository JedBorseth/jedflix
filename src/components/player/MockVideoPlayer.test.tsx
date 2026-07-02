import { mock, test, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

mock.module("convex/react", () => ({
  useMutation: () => mock(() => Promise.resolve()),
  Authenticated: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { MockVideoPlayer } from "./MockVideoPlayer";

test("MockVideoPlayer shows demo playback label", () => {
  render(
    <MemoryRouter>
      <MockVideoPlayer
        movieId={123}
        mediaType="movie"
        title="Neon Horizon"
        durationMinutes={128}
      />
    </MemoryRouter>,
  );

  expect(screen.getByText("Demo playback")).toBeInTheDocument();
  expect(screen.getByText("Mock stream — no video file")).toBeInTheDocument();
});
