import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ExternalPlayerHandoff } from "./ExternalPlayerHandoff";

const directUrl = "https://cdn.example.com/selected-movie.mkv";
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execCommandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);
const writeText = mock(async (_text: string) => {});
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
let failResolve = false;

let restoreFetch = () => {};

beforeEach(() => {
  requests.length = 0;
  failResolve = false;
  writeText.mockReset();
  writeText.mockImplementation(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => false,
  });
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    async (input, init) => {
      const url = String(input);
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      if (url.endsWith("/sources")) {
        return Response.json({
          sources: [
            {
              id: "selected-source",
              title: "Example Movie 1080p.mkv",
              magnet: "magnet:?xt=urn:btih:example",
            },
          ],
        });
      }
      if (url.endsWith("/resolve")) {
        return failResolve
          ? Response.json(
              { error: "Resolve unavailable", code: "rate_limited" },
              { status: 429 },
            )
          : Response.json({
              url: "/proxy/not-the-direct-link",
              directUrl,
              mode: "direct",
            });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  );
  restoreFetch = () => {
    fetchSpy.mockRestore();
  };
});

afterEach(() => {
  cleanup();
  restoreFetch();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (execCommandDescriptor)
    Object.defineProperty(document, "execCommand", execCommandDescriptor);
  else Reflect.deleteProperty(document, "execCommand");
});

function renderCopyDestination() {
  render(
    <MemoryRouter>
      <ExternalPlayerHandoff
        mediaType="movie"
        title="Example Movie"
        imdbId="tt123"
        realDebridApiKey="test-key"
        backPath="/movie/123"
        destination="copy"
      />
    </MemoryRouter>,
  );
}

test("copy destination waits for stream selection and copies the direct URL without launching a player", async () => {
  const initialLocation = window.location.href;
  renderCopyDestination();
  const source = await screen.findByRole("button", {
    name: /Example Movie 1080p.mkv/,
  });
  expect(requests.some((request) => request.url.endsWith("/resolve"))).toBe(
    false,
  );
  expect(writeText).not.toHaveBeenCalled();

  fireEvent.click(source);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Stream URL copied to clipboard.",
  );
  expect(writeText).toHaveBeenCalledWith(directUrl);
  expect(screen.getByRole("textbox", { name: "Stream URL" })).toHaveValue(
    directUrl,
  );
  expect(window.location.href).toBe(initialLocation);
  expect(
    screen.queryByRole("link", { name: /Open in/ }),
  ).not.toBeInTheDocument();
  expect(
    requests.find((request) => request.url.endsWith("/resolve"))?.body
      .playbackProfile,
  ).toBe("external");
});

test("blocked automatic clipboard access can be retried with the copy button", async () => {
  writeText.mockRejectedValue(new Error("Clipboard requires a user gesture"));
  renderCopyDestination();
  fireEvent.click(
    await screen.findByRole("button", { name: /Example Movie 1080p.mkv/ }),
  );
  await screen.findByRole("textbox", { name: "Stream URL" });
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  writeText.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Copy stream URL" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Stream URL copied to clipboard.",
  );
  expect(writeText).toHaveBeenLastCalledWith(directUrl);
});

test("failed stream resolution does not copy an unresolved URL", async () => {
  failResolve = true;
  renderCopyDestination();
  fireEvent.click(
    await screen.findByRole("button", { name: /Example Movie 1080p.mkv/ }),
  );
  expect(await screen.findByText(/Resolve unavailable/)).toBeInTheDocument();
  expect(writeText).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: "Stream URL" }),
  ).not.toBeInTheDocument();
});
