import { describe, expect, test } from "bun:test";
import {
  AUDIO_HAVE_CURRENT_DATA,
  AUDIO_STALL_TIMEOUT_MS,
  decideAudioErrorAction,
  decideAudioStallAction,
  isAudibleAudioElement,
  shouldRestartCurrentTrack,
} from "./musicPlaybackError";

describe("decideAudioErrorAction", () => {
  test("retries the same track before skipping", () => {
    expect(
      decideAudioErrorAction({
        playIntent: true,
        retryCount: 0,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("retry");
  });

  test("skips to the next track after retries are exhausted", () => {
    expect(
      decideAudioErrorAction({
        playIntent: true,
        retryCount: 1,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("skip");
  });

  test("stops when the queue has no next track", () => {
    expect(
      decideAudioErrorAction({
        playIntent: true,
        retryCount: 1,
        consecutiveFailSkips: 0,
        hasNextTrack: false,
      }),
    ).toBe("stop");
  });

  test("stops after too many consecutive skips so a YouTube outage cannot burn the queue", () => {
    expect(
      decideAudioErrorAction({
        playIntent: true,
        retryCount: 1,
        consecutiveFailSkips: 5,
        hasNextTrack: true,
      }),
    ).toBe("stop");
  });

  test("does not retry when the user paused", () => {
    expect(
      decideAudioErrorAction({
        playIntent: false,
        retryCount: 0,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("stop");
  });
});

describe("decideAudioStallAction", () => {
  test("waits until the stall timeout when there is no audible progress", () => {
    expect(
      decideAudioStallAction({
        playIntent: true,
        audible: false,
        msSinceLoad: AUDIO_STALL_TIMEOUT_MS - 1,
        retryCount: 0,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("wait");
  });

  test("retries once after the stall timeout with no timeupdate", () => {
    expect(
      decideAudioStallAction({
        playIntent: true,
        audible: false,
        msSinceLoad: AUDIO_STALL_TIMEOUT_MS,
        retryCount: 0,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("retry");
  });

  test("skips after a stall retry is still silent when another track exists", () => {
    expect(
      decideAudioStallAction({
        playIntent: true,
        audible: false,
        msSinceLoad: AUDIO_STALL_TIMEOUT_MS,
        retryCount: 1,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("skip");
  });

  test("stops after the consecutive auto-skip cap even if more tracks remain", () => {
    expect(
      decideAudioStallAction({
        playIntent: true,
        audible: false,
        msSinceLoad: AUDIO_STALL_TIMEOUT_MS,
        retryCount: 1,
        consecutiveFailSkips: 5,
        hasNextTrack: true,
      }),
    ).toBe("stop");
  });

  test("stops without skipping when the user paused", () => {
    expect(
      decideAudioStallAction({
        playIntent: false,
        audible: false,
        msSinceLoad: AUDIO_STALL_TIMEOUT_MS,
        retryCount: 0,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("stop");
  });

  test("does not stall-retry after audio is audible", () => {
    expect(
      decideAudioStallAction({
        playIntent: true,
        audible: true,
        msSinceLoad: AUDIO_STALL_TIMEOUT_MS,
        retryCount: 0,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("wait");
  });

  test("shares the media-error retry limiter so a stall retry plus an error cannot loop", () => {
    expect(
      decideAudioErrorAction({
        playIntent: true,
        retryCount: 1,
        consecutiveFailSkips: 0,
        hasNextTrack: true,
      }),
    ).toBe("skip");
  });
});

describe("shouldRestartCurrentTrack", () => {
  test("goes to the previous index when the load is not audible, even if currentTime > 3", () => {
    expect(
      shouldRestartCurrentTrack({ audible: false, currentTimeSec: 0 }),
    ).toBe(false);
    expect(
      shouldRestartCurrentTrack({ audible: false, currentTimeSec: 12 }),
    ).toBe(false);
  });

  test("seeks to 0 when audio is flowing past the restart threshold", () => {
    expect(
      shouldRestartCurrentTrack({ audible: true, currentTimeSec: 3.1 }),
    ).toBe(true);
  });

  test("does not restart an audible track in the first three seconds", () => {
    expect(
      shouldRestartCurrentTrack({ audible: true, currentTimeSec: 2 }),
    ).toBe(false);
  });
});

describe("isAudibleAudioElement", () => {
  test("requires unpaused data, not merely that play() was called", () => {
    expect(
      isAudibleAudioElement({
        paused: false,
        readyState: AUDIO_HAVE_CURRENT_DATA - 1,
      }),
    ).toBe(false);
    expect(
      isAudibleAudioElement({
        paused: true,
        readyState: AUDIO_HAVE_CURRENT_DATA,
      }),
    ).toBe(false);
    expect(
      isAudibleAudioElement({
        paused: false,
        readyState: AUDIO_HAVE_CURRENT_DATA,
      }),
    ).toBe(true);
  });
});
