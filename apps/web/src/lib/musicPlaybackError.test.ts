import { describe, expect, test } from "bun:test";
import { decideAudioErrorAction } from "./musicPlaybackError";

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
