import { describe, expect, test } from "bun:test";
import {
  formatStreamFailure,
  mapMediaElementError,
  mapMusicAudioError,
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

describe("mapMusicAudioError", () => {
  test("does not call Safari code 4 an unsupported format", () => {
    const media = {
      error: { code: 4, message: "The operation is not supported." },
    } as unknown as HTMLMediaElement;
    const message = mapMusicAudioError(media);
    expect(message.toLowerCase()).not.toContain("format is not supported");
    expect(message).toContain("AAC/M4A");
  });

  test("explains expired/dropped streams for generic code 4", () => {
    const media = {
      error: { code: 4, message: "" },
    } as unknown as HTMLMediaElement;
    expect(mapMusicAudioError(media)).toContain("AAC/M4A");
    expect(mapMusicAudioError(media).toLowerCase()).toContain(
      "not an unsupported format",
    );
  });
});
