import { describe, expect, test } from "bun:test";
import {
  ARTWORK_FULL_QUEUE_LIMIT,
  artworkForTrack,
  extendQueueIfPrefix,
  planQueueSourceSync,
  rememberTrackArtwork,
  stripQueueArtwork,
  withCachedArtwork,
} from "@/lib/musicQueueArtwork";

function track(id: string, imageUrl = `https://img/${id}`) {
  return { id, imageUrl };
}

describe("musicQueueArtwork", () => {
  test("stripQueueArtwork keeps art near the current index and caches the rest", () => {
    const tracks = Array.from({ length: ARTWORK_FULL_QUEUE_LIMIT + 20 }, (_, i) =>
      track(`t${i}`),
    );
    const stripped = stripQueueArtwork(tracks, 10, 2);

    expect(stripped[10]?.imageUrl).toBe("https://img/t10");
    expect(stripped[8]?.imageUrl).toBe("https://img/t8");
    expect(stripped[12]?.imageUrl).toBe("https://img/t12");
    expect(stripped[0]?.imageUrl).toBe("");
    expect(stripped[50]?.imageUrl).toBe("");
    expect(artworkForTrack("t50")).toBe("https://img/t50");
    expect(withCachedArtwork(stripped[50]!).imageUrl).toBe("https://img/t50");
  });

  test("stripQueueArtwork leaves small queues intact", () => {
    const tracks = [track("a"), track("b"), track("c")];
    expect(stripQueueArtwork(tracks, 0)).toEqual(tracks);
  });

  test("rememberTrackArtwork + artworkForTrack round-trip", () => {
    rememberTrackArtwork([track("x", "https://cdn/x")]);
    expect(artworkForTrack("x")).toBe("https://cdn/x");
    expect(artworkForTrack("missing", "fallback")).toBe("fallback");
  });

  test("extendQueueIfPrefix grows only when next extends prev by id", () => {
    const prev = [track("a"), track("b")];
    const next = [track("a"), track("b"), track("c")];
    expect(extendQueueIfPrefix(prev, next)?.map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(extendQueueIfPrefix(prev, prev)).toBeNull();
    expect(
      extendQueueIfPrefix(prev, [track("a"), track("z"), track("c")]),
    ).toBeNull();
  });

  test("planQueueSourceSync remaps the current track when order changes", () => {
    const prev = [track("a"), track("b"), track("c")];
    const next = [track("c"), track("a"), track("b"), track("d")];
    const planned = planQueueSourceSync({
      prev,
      next,
      currentId: "b",
    });
    expect(planned?.queue.map((t) => t.id)).toEqual(["c", "a", "b", "d"]);
    expect(planned?.queueIndex).toBe(2);
  });

  test("planQueueSourceSync refuses to drop the playing track", () => {
    expect(
      planQueueSourceSync({
        prev: [track("a"), track("b")],
        next: [track("c"), track("d")],
        currentId: "a",
      }),
    ).toBeNull();
  });
});
