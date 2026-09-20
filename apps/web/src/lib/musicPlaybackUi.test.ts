import { describe, expect, test } from "bun:test";
import {
  MEDIA_HAVE_CURRENT_DATA,
  musicPlaybackPresentation,
  nextMusicAudible,
} from "./musicPlaybackUi";

describe("musicPlaybackPresentation", () => {
  test("playIntent with no data is paused/loading and does not publish a 1x clock", () => {
    expect(
      musicPlaybackPresentation({
        hasCurrent: true,
        playIntent: true,
        audible: false,
        hasData: false,
        elapsedSec: 0,
      }),
    ).toEqual({
      playing: false,
      loading: true,
      playbackState: "paused",
      publishPosition: false,
      positionSec: 0,
    });
  });

  test("resume after pause keeps elapsed and does not publish a 1x clock until audible", () => {
    expect(
      musicPlaybackPresentation({
        hasCurrent: true,
        playIntent: true,
        audible: false,
        hasData: true,
        elapsedSec: 42,
      }),
    ).toEqual({
      playing: false,
      loading: false,
      playbackState: "paused",
      publishPosition: false,
      positionSec: 42,
    });
  });

  test("first audible timeupdate with data is playing and publishes position", () => {
    expect(
      musicPlaybackPresentation({
        hasCurrent: true,
        playIntent: true,
        audible: true,
        elapsedSec: 1.4,
      }),
    ).toEqual({
      playing: true,
      loading: false,
      playbackState: "playing",
      publishPosition: true,
      positionSec: 1.4,
    });
  });

  test("src swap resets to not audible — resolving with frozen clock at 0", () => {
    const afterSwap = nextMusicAudible({
      event: "srcswap",
      readyState: 4,
      paused: true,
    });
    expect(afterSwap).toBe(false);
    expect(
      musicPlaybackPresentation({
        hasCurrent: true,
        playIntent: true,
        audible: afterSwap,
        hasData: false,
        elapsedSec: 0,
      }),
    ).toEqual({
      playing: false,
      loading: true,
      playbackState: "paused",
      publishPosition: false,
      positionSec: 0,
    });
  });

  test("user pause (playIntent false) is paused, not loading, clock stays", () => {
    expect(
      musicPlaybackPresentation({
        hasCurrent: true,
        playIntent: false,
        audible: false,
        elapsedSec: 42,
      }),
    ).toEqual({
      playing: false,
      loading: false,
      playbackState: "paused",
      publishPosition: false,
      positionSec: 42,
    });
  });

  test("error clears loading without publishing a playing clock", () => {
    expect(
      musicPlaybackPresentation({
        hasCurrent: true,
        playIntent: true,
        audible: false,
        hasError: true,
        elapsedSec: 3,
      }),
    ).toEqual({
      playing: false,
      loading: false,
      playbackState: "paused",
      publishPosition: false,
      positionSec: 3,
    });
  });

  test("no current track is idle", () => {
    expect(
      musicPlaybackPresentation({
        hasCurrent: false,
        playIntent: false,
        audible: false,
      }),
    ).toEqual({
      playing: false,
      loading: false,
      playbackState: "none",
      publishPosition: false,
      positionSec: 0,
    });
  });
});

describe("nextMusicAudible", () => {
  test("timeupdate with data and not paused becomes audible", () => {
    expect(
      nextMusicAudible({
        event: "timeupdate",
        readyState: MEDIA_HAVE_CURRENT_DATA,
        paused: false,
      }),
    ).toBe(true);
  });

  test("timeupdate without data stays silent", () => {
    expect(
      nextMusicAudible({
        event: "timeupdate",
        readyState: 1,
        paused: false,
      }),
    ).toBe(false);
  });

  test("canplay with HAVE_CURRENT_DATA and not paused becomes audible", () => {
    expect(
      nextMusicAudible({
        event: "canplay",
        readyState: MEDIA_HAVE_CURRENT_DATA,
        paused: false,
      }),
    ).toBe(true);
  });

  test("canplay while paused is not audible", () => {
    expect(
      nextMusicAudible({
        event: "canplay",
        readyState: 4,
        paused: true,
      }),
    ).toBe(false);
  });

  test("waiting without data is not audible", () => {
    expect(
      nextMusicAudible({
        event: "waiting",
        readyState: 0,
        paused: false,
      }),
    ).toBe(false);
  });

  test("waiting with data while playing stays audible", () => {
    expect(
      nextMusicAudible({
        event: "waiting",
        readyState: 4,
        paused: false,
      }),
    ).toBe(true);
  });

  test("error, pause, and ended clear audible", () => {
    for (const event of ["error", "pause", "ended"] as const) {
      expect(
        nextMusicAudible({
          event,
          readyState: 4,
          paused: true,
        }),
      ).toBe(false);
    }
  });
});
