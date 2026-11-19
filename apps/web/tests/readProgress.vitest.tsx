// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { catalogQueryKeys, createAppQueryClient } from "@/lib/queryClient";
import { ReadPage } from "@/pages/ReadPage";

const workId = "OL123W";
let history: { mediaType: "ebook"; workId: string; fileIndex: number; location: string }[] | undefined;
const display = vi.fn();
const renderTo = vi.fn(() => ({ display, on: vi.fn(), off: vi.fn() }));
vi.mock("epubjs", () => ({
  default: () => ({ renderTo, destroy: vi.fn() }),
}));
vi.mock("convex/react", () => ({
  useQuery: () => history,
  useMutation: () => vi.fn(),
}));
vi.mock("@/hooks/useUserSettings", () => ({
  useUserSettings: () => ({ settings: { realDebridApiKey: "test-key" } }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("opens the saved EPUB file and location once after history loads", async () => {
  history = undefined;
  const files = ["first", "saved"].map((name, index) => ({
    fileId: index + 1,
    index,
    filename: `${name}.epub`,
    url: `https://example.com/${name}.epub`,
  }));
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input.endsWith("/sources")) {
      return Response.json({
        sources: [{ id: "source", title: "Example pack", magnet: "magnet:?xt=urn:btih:example" }],
      });
    }
    if (input.endsWith("/resolve")) {
      return Response.json({ url: files[0].url, files });
    }
    throw new Error(`Unexpected request: ${input}`);
  }));
  const client = createAppQueryClient();
  client.setQueryData(catalogQueryKeys.openLibrary.work(workId), {
    id: workId,
    title: "Example book",
    authors: ["Example author"],
  });
  function page() {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/read/${workId}`]}>
          <Routes>
            <Route path="/read/:workId" element={<ReadPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  const { rerender } = render(page());

  fireEvent.click(await screen.findByRole("button", { name: /Example pack/ }));
  await screen.findByRole("button", { name: "saved.epub" });
  expect(renderTo).not.toHaveBeenCalled();

  const saved = {
    mediaType: "ebook" as const,
    workId,
    fileIndex: 1,
    location: "epubcfi(/6/4!/4/2)",
  };
  history = [saved];
  rerender(page());
  expect(renderTo).toHaveBeenCalledTimes(1);
  expect(display).toHaveBeenCalledExactlyOnceWith(saved.location);

  history = [{ ...saved, location: "epubcfi(/6/4!/4/4)" }];
  rerender(page());
  expect(renderTo).toHaveBeenCalledTimes(1);
  expect(display).toHaveBeenCalledExactlyOnceWith(saved.location);
});
