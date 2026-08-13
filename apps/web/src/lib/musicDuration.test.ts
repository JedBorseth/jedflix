import { describe, expect, test } from "bun:test";
import {
  AUDIO_DURATION_HEADER,
  durationMsFromAudioHeaders,
  pickMusicDurationSec,
} from "./musicDuration";

describe("pickMusicDurationSec", () => {
  test("prefers yt-dlp resolved duration over catalog and stream", () => {
    expect(
      pickMusicDurationSec({
        catalogSec: 180,
        resolvedSec: 181.2,
        streamSec: 360,
      }),
    ).toBe(181.2);
  });

  test("falls back to catalog when yt-dlp has not resolved yet", () => {
    expect(
      pickMusicDurationSec({
        catalogSec: 180,
        streamSec: 360,
      }),
    ).toBe(180);
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
