import { expect, test } from "bun:test";
import {
  getPlaybackDestinationPath,
  getPlaybackPlayer,
} from "./playbackDestination";

test("playback defaults to web and accepts only supported external players", () => {
  expect(getPlaybackPlayer(new URLSearchParams())).toBe("web");
  expect(getPlaybackPlayer(new URLSearchParams("player=web"))).toBe("web");
  expect(getPlaybackPlayer(new URLSearchParams("player=vlc"))).toBe("vlc");
  expect(getPlaybackPlayer(new URLSearchParams("player=outplayer"))).toBe(
    "outplayer",
  );
  expect(getPlaybackPlayer(new URLSearchParams("player=unsupported"))).toBe(
    "web",
  );
});

test("destination URLs preserve other parameters and replace the previous player", () => {
  expect(
    getPlaybackDestinationPath(
      "/watch/movie/123?resume=42&player=vlc#stream",
      "web",
    ),
  ).toBe("/watch/movie/123?resume=42&player=web#stream");
});
