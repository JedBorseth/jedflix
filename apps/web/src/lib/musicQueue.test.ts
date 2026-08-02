import { describe, expect, test } from "bun:test";
import {
  dropIndexFromDrag,
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

  test("dropIndexFromDrag snaps by row height", () => {
    expect(dropIndexFromDrag(2, 64, 64, 5)).toBe(3);
    expect(dropIndexFromDrag(2, -80, 64, 5)).toBe(1);
    expect(dropIndexFromDrag(0, -100, 64, 5)).toBe(0);
    expect(dropIndexFromDrag(4, 200, 64, 5)).toBe(4);
  });
});
