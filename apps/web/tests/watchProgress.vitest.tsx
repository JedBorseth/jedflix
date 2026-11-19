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

test("retries a rejected periodic write when playback stops at the same position", async () => {
  const client = new ConvexReactClient("https://example.convex.cloud");
  let rejectWrite!: (error: Error) => void;
  const pending = new Promise<never>((_, reject) => {
    rejectWrite = reject;
  });
  const mutation = vi.spyOn(client, "mutation").mockResolvedValue(null).mockReturnValueOnce(pending);
  const { result, unmount } = renderHook(() => useWatchProgressSaver(42, "tv", 1, 1), {
    wrapper: ({ children }: PropsWithChildren) => (
      <ConvexProvider client={client}>{children}</ConvexProvider>
    ),
  });

  try {
    result.current.update(12);
    result.current.flush();
    expect(mutation).toHaveBeenCalledTimes(1);

    rejectWrite(new Error("Write failed"));
    await pending.catch(() => {});
    result.current.finish(12);
    expect(mutation.mock.calls.map(([, args]) => args?.progressSeconds)).toEqual([12, 12]);

    await Promise.resolve();
    result.current.flush();
    expect(mutation).toHaveBeenCalledTimes(2);
  } finally {
    unmount();
  }
});
