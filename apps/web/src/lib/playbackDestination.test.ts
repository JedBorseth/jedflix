import { expect, test } from "bun:test";
import {
  getPlaybackDestinationPath,
  getPlaybackDestination,
} from "./playbackDestination";

test("playback defaults to web and accepts supported destinations", () => {
  expect(getPlaybackDestination(new URLSearchParams())).toBe("web");
  expect(getPlaybackDestination(new URLSearchParams("player=web"))).toBe("web");
  expect(getPlaybackDestination(new URLSearchParams("player=vlc"))).toBe("vlc");
  expect(getPlaybackDestination(new URLSearchParams("player=copy"))).toBe(
    "copy",
  );
  expect(getPlaybackDestination(new URLSearchParams("player=outplayer"))).toBe(
    "outplayer",
  );
  expect(
    getPlaybackDestination(new URLSearchParams("player=unsupported")),
  ).toBe("web");
});

test("destination URLs preserve other parameters and replace the previous player", () => {
  expect(
    getPlaybackDestinationPath(
      "/watch/movie/123?resume=42&player=vlc#stream",
      "web",
    ),
  ).toBe("/watch/movie/123?resume=42&player=web#stream");
});
