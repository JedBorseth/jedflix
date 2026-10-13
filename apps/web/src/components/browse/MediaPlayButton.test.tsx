import { afterEach, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { MediaPlayButton } from "./MediaPlayButton";
import {
  clearUserSettings,
  getUserSettings,
  saveUserSettings,
} from "@/lib/userSettings";

afterEach(clearUserSettings);

function renderPlayButton(options?: {
  to?: string;
  useAnchor?: boolean;
  requireDebrid?: boolean;
}) {
  const router = createMemoryRouter(
    [
      {
        path: "/movie/123",
        element: (
          <MediaPlayButton
            media={{ year: 2024 }}
            to="/watch/movie/123"
            {...options}
          />
        ),
      },
      { path: "/watch/movie/123", element: <p>Movie playback</p> },
      { path: "/watch/tv/123/2/3", element: <p>Episode playback</p> },
    ],
    { initialEntries: ["/movie/123"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

test("Play asks where to watch before navigating, with TV unavailable", () => {
  const router = renderPlayButton();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  expect(router.state.location.pathname).toBe("/movie/123");
  expect(
    screen.getByRole("dialog", { name: "Where do you want to watch?" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "This device" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "TV" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Watch on TV/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Watch on TV/ }));
  expect(router.state.location.pathname).toBe("/movie/123");

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/movie/123");
});

for (const [label, player] of [
  ["Web", "web"],
  ["VLC", "vlc"],
  ["Outplayer", "outplayer"],
  ["Copy stream URL", "copy"],
]) {
  test(`${label} uses the chosen destination without changing the saved preference`, () => {
    saveUserSettings({ externalPlayer: "outplayer" });
    const router = renderPlayButton();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(router.state.location.pathname).toBe("/watch/movie/123");
    expect(router.state.location.search).toBe(`?player=${player}`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getUserSettings().externalPlayer).toBe("outplayer");
  });
}

test("episode playback carries the selected player", () => {
  const router = renderPlayButton({ to: "/watch/tv/123/2/3" });
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  fireEvent.click(screen.getByRole("button", { name: "VLC" }));
  expect(router.state.location.pathname).toBe("/watch/tv/123/2/3");
  expect(router.state.location.search).toBe("?player=vlc");
});

test("a locked Play button does not open the menu", () => {
  const router = renderPlayButton({ requireDebrid: true });
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/movie/123");
});

test("Browse Episodes remains an anchor", () => {
  renderPlayButton({ to: "#episodes", useAnchor: true });
  expect(screen.getByRole("link", { name: "Play" })).toHaveAttribute(
    "href",
    "#episodes",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
