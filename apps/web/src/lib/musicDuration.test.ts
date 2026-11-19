import { describe, expect, test } from "bun:test";
import {
  AUDIO_DURATION_HEADER,
  durationMsFromAudioHeaders,
  pickMusicDurationSec,
} from "./musicDuration";

describe("pickMusicDurationSec", () => {
  test("prefers catalog duration over resolved and stream durations", () => {
    expect(
      pickMusicDurationSec({
        catalogSec: 180,
        resolvedSec: 181.2,
        streamSec: 360,
      }),
    ).toBe(180);
  });

  test("keeps catalog duration while yt-dlp resolves", () => {
    expect(
      pickMusicDurationSec({
        catalogSec: 180,
        streamSec: 360,
      }),
    ).toBe(180);
  });

  test("falls back to resolved duration when the catalog duration is missing or invalid", () => {
    for (const catalogSec of [undefined, null, 0, -1, NaN, Infinity]) {
      expect(pickMusicDurationSec({ catalogSec, resolvedSec: 181.2 })).toBe(181.2);
    }
  });

  test("does not use inflated HTML5 stream duration alone", () => {
    expect(pickMusicDurationSec({ streamSec: 360 })).toBe(0);
  });
});

describe("durationMsFromAudioHeaders", () => {
  test("reads X-Audio-Duration-Ms", () => {
    const headers = new Headers({ [AUDIO_DURATION_HEADER]: "181000" });
    expect(durationMsFromAudioHeaders(headers)).toBe(181000);
  });

  test("returns null for missing or invalid values", () => {
    expect(durationMsFromAudioHeaders(new Headers())).toBeNull();
    expect(
      durationMsFromAudioHeaders(new Headers({ [AUDIO_DURATION_HEADER]: "0" })),
    ).toBeNull();
  });
});
