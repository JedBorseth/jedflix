import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  Link,
  Outlet,
  RouterProvider,
} from "react-router-dom";
import { ScrollToTopOnNavigate } from "./ScrollToTopOnNavigate";

const matchMedia = window.matchMedia.bind(window);
const originalTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);

afterEach(() => {
  window.matchMedia = matchMedia;
  window.scrollTo(0, 0);
  if (originalTransition) {
    Object.defineProperty(document, "startViewTransition", originalTransition);
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});

function renderNavigation(initialPath = "/movies") {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <ScrollToTopOnNavigate />
            <Outlet />
          </>
        ),
        children: [
          {
            path: "*",
            element: (
              <Link to="/movie/863" viewTransition>
                Open movie
              </Link>
            ),
          },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

test("desktop movie navigation resets the page scroll with view transitions enabled", async () => {
  const startTransition = mock((update: () => Promise<void>) => {
    const updateCallbackDone = Promise.resolve().then(update);
    return {
      ready: Promise.resolve(),
      updateCallbackDone,
      finished: updateCallbackDone,
      skipTransition() {},
    };
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: startTransition,
  });
  renderNavigation();
  window.scrollTo(0, 900);
  expect(window.scrollY).toBe(900);

  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name: "Open movie" }));
  });

  await waitFor(() => expect(window.scrollY).toBe(0));
  expect(startTransition).toHaveBeenCalledTimes(1);
});

test("navigating between detail pages also resets the scroll", async () => {
  const router = renderNavigation("/movie/301528");
  window.scrollTo(0, 900);

  await act(async () => {
    await router.navigate("/movie/863");
  });

  expect(window.scrollY).toBe(0);
});

test("mobile navigation continues to reset the scroll", async () => {
  window.matchMedia = (query) => ({ ...matchMedia(query), matches: true });
  const router = renderNavigation();
  window.scrollTo(0, 900);

  await act(async () => {
    await router.navigate("/movie/863");
  });

  expect(window.scrollY).toBe(0);
});

test("an episode anchor within a page does not reset its scroll", async () => {
  const router = renderNavigation("/tv/1396");
  window.scrollTo(0, 900);
  const scrollTo = spyOn(window, "scrollTo");
  try {
    await act(async () => {
      await router.navigate("/tv/1396#episodes");
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(900);
  } finally {
    scrollTo.mockRestore();
  }
});
