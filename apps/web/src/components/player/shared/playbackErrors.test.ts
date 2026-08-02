import { describe, expect, test } from "bun:test";
import {
  formatStreamFailure,
  mapMediaElementError,
  mapVideoJsError,
} from "./playbackErrors";

describe("formatStreamFailure", () => {
  test("expands Safari Load failed TypeError", () => {
    const error = new TypeError("Load failed");
    expect(formatStreamFailure(error)).toContain("Network request failed");
    expect(formatStreamFailure(error)).toContain("Load failed");
  });

  test("keeps useful resolve messages", () => {
    expect(formatStreamFailure(new Error("No audiobook files found"))).toBe(
      "No audiobook files found",
    );
  });
});

describe("mapVideoJsError", () => {
  test("maps media error codes", () => {
    expect(mapVideoJsError(2)).toContain("network error");
    expect(mapVideoJsError(4)).toContain("not supported");
  });
});

describe("mapMediaElementError", () => {
  test("handles missing media element", () => {
    expect(mapMediaElementError(null)).toContain("unknown reason");
  });
});
