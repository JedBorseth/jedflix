import { describe, expect, test } from "bun:test";
import {
  dropIndexFromDrag,
  promoteRecommendationToQueue,
  remapIndexAfterReorder,
  reorderItems,
} from "@/lib/musicQueue";

describe("musicQueue helpers", () => {
  test("reorderItems moves an item and leaves others intact", () => {
    expect(reorderItems(["a", "b", "c", "d"], 1, 3)).toEqual(["a", "c", "d", "b"]);
    expect(reorderItems(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorderItems(["a", "b"], 0, 0)).toEqual(["a", "b"]);
    expect(reorderItems(["a", "b"], -1, 1)).toEqual(["a", "b"]);
  });

  test("remapIndexAfterReorder keeps the current track selected", () => {
    // Dragging the current track
    expect(remapIndexAfterReorder(1, 1, 3)).toBe(3);
    // Dragging an earlier track past the current
    expect(remapIndexAfterReorder(2, 0, 3)).toBe(1);
    // Dragging a later track before the current
    expect(remapIndexAfterReorder(1, 3, 0)).toBe(2);
    // Unrelated move
    expect(remapIndexAfterReorder(0, 2, 3)).toBe(0);
  });

  test("promoteRecommendationToQueue appends to the playable queue", () => {
    const result = promoteRecommendationToQueue(
      [{ id: "a" }, { id: "b" }],
      [{ id: "c" }, { id: "d" }],
      "c",
    );
    expect(result.queue.map((track) => track.id)).toEqual(["a", "b", "c"]);
    expect(result.recommendations.map((track) => track.id)).toEqual(["d"]);
    expect(result.promoted?.id).toBe("c");
  });

  test("promoteRecommendationToQueue skips duplicates already in the queue", () => {
    const result = promoteRecommendationToQueue(
      [{ id: "a" }, { id: "c" }],
      [{ id: "c" }, { id: "d" }],
      "c",
    );
    expect(result.queue.map((track) => track.id)).toEqual(["a", "c"]);
    expect(result.recommendations.map((track) => track.id)).toEqual(["d"]);
  });

  test("dropIndexFromDrag snaps by row height", () => {
    expect(dropIndexFromDrag(2, 64, 64, 5)).toBe(3);
    expect(dropIndexFromDrag(2, -80, 64, 5)).toBe(1);
    expect(dropIndexFromDrag(0, -100, 64, 5)).toBe(0);
    expect(dropIndexFromDrag(4, 200, 64, 5)).toBe(4);
  });
});
