// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  MusicPlayerProvider,
  useMusicPlayer,
} from "@/components/player/music/MusicPlayerContext";
import { AUDIO_STALL_TIMEOUT_MS } from "@/lib/musicPlaybackError";

vi.mock("@/lib/musicInteractions", () => ({
  useMusicInteractionLog: () => () => {},
}));
let player: ReturnType<typeof useMusicPlayer>;
function Probe() {
  player = useMusicPlayer();
  return null;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("autoplay-blocked guest audio waits for a gesture instead of skipping the party queue", async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
    new DOMException("Gesture required", "NotAllowedError"),
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ durationMs: 180000 }), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  const first = {
    id: "one",
    title: "One",
    artists: ["Artist"],
    albumName: "Album",
    imageUrl: "",
    durationMs: 180000,
  };
  const second = { ...first, id: "two", title: "Two" };
  render(
    <MusicPlayerProvider>
      <Probe />
    </MusicPlayerProvider>,
  );
  await act(async () => {
    player.playTrack(first, [first, second]);
  });
  expect(player.error).toBe("Tap Play to start audio on this device.");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AUDIO_STALL_TIMEOUT_MS * 4);
  });
  expect(player.current?.id).toBe("one");
  expect(player.queueIndex).toBe(0);
  expect(player.error).toBe("Tap Play to start audio on this device.");
});

test("party queue edits keep previous tracks and do not restart paused audio", async () => {
  vi.useFakeTimers();
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ durationMs: 180000 }), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  const first = {
    id: "one",
    title: "One",
    artists: ["Artist"],
    albumName: "Album",
    imageUrl: "",
    durationMs: 180000,
  };
  const second = { ...first, id: "two", title: "Two" };
  const third = { ...first, id: "three", title: "Three" };
  render(
    <MusicPlayerProvider>
      <Probe />
    </MusicPlayerProvider>,
  );
  await act(async () => {
    player.playTrack(second, [first, second]);
  });
  act(() => player.pause());
  const starts = play.mock.calls.length;
  act(() => player.syncPartyQueue([second, third]));
  expect(player.queue.map((track) => track.id)).toEqual([
    "one",
    "two",
    "three",
  ]);
  expect(player.queueIndex).toBe(1);
  expect(player.current?.id).toBe("two");
  expect(play.mock.calls).toHaveLength(starts);
  act(() => player.previous());
  expect(player.current?.id).toBe("one");
});
