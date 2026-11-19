// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { PropsWithChildren } from "react";
import { useWatchProgressSaver } from "@/components/player/shared/useWatchProgressSaver";

test("saves during continuous playback and flushes the current episode on stop and cleanup", () => {
  const client = new ConvexReactClient("https://example.convex.cloud");
  const mutation = vi.spyOn(client, "mutation").mockResolvedValue(null);
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const { result, rerender, unmount } = renderHook(
    (episode) => useWatchProgressSaver(42, "tv", 1, episode),
    {
      initialProps: 1,
      wrapper: ({ children }: PropsWithChildren) => (
        <ConvexProvider client={client}>{children}</ConvexProvider>
      ),
    },
  );

  try {
    for (let second = 1; second <= 25; second += 1) {
      clock.mockReturnValue(second * 1000);
      result.current.update(second);
    }
    expect(mutation.mock.calls.map(([, args]) => args?.progressSeconds)).toEqual([1, 11, 21]);

    result.current.finish(26);
    result.current.finish(26);
    result.current.update(27);
    rerender(2);
    result.current.update(1);
    result.current.update(2);
    unmount();

    expect(mutation.mock.calls.map(([, args]) => [args?.episode, args?.progressSeconds])).toEqual([
      [1, 1], [1, 11], [1, 21], [1, 26], [1, 27], [2, 1], [2, 2],
    ]);
  } finally {
    unmount();
    clock.mockRestore();
  }
});
