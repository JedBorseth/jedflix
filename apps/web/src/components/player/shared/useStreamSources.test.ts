import { expect, spyOn, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { SourcesRequest } from "@/lib/streamApi";
import { useStreamSources } from "./useStreamSources";

test("an older request settling during a retry cannot update the source list", async () => {
  const first = Promise.withResolvers<Response>();
  const retry = Promise.withResolvers<Response>();
  const fetch = spyOn(globalThis, "fetch")
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(retry.promise);
  const request: SourcesRequest = { type: "movie", imdbId: "tt123" };
  const reset = () => {};
  const { result, unmount } = renderHook(() => useStreamSources(request, undefined, reset));

  try {
    act(() => {
      void result.current.loadSources();
    });
    await act(async () => {
      first.reject(new Error("Earlier search failed"));
    });
    expect(result.current.sourcesLoading).toBe(true);
    expect(result.current.sourcesError).toBeNull();

    await act(async () => {
      retry.resolve(Response.json({
        sources: [
          { id: "b", title: "Second", magnet: "magnet:b" },
          { id: "a", title: "First", magnet: "magnet:a" },
        ],
      }));
    });
    expect(result.current.sourcesLoading).toBe(false);
    expect(result.current.sources.map(({ id }) => id)).toEqual(["b", "a"]);
  } finally {
    unmount();
    fetch.mockRestore();
  }
});
