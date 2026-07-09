import { afterEach, describe, expect, test } from "bun:test";
import {
  buildExternalPlayerUrl,
  detectExternalPlayerPlatform,
  toAbsolutePlaybackUrl,
} from "@/lib/externalPlayer";
import {
  clearUserSettings,
  getUserSettings,
  saveUserSettings,
} from "@/lib/userSettings";

describe("externalPlayer", () => {
  test("builds VLC iOS deep link", () => {
    const url = buildExternalPlayerUrl(
      "vlc",
      "https://example.com/video.mkv",
      "ios",
    );
    expect(url).toBe(
      "vlc-x-callback://x-callback-url/stream?url=https%3A%2F%2Fexample.com%2Fvideo.mkv",
    );
  });

  test("builds OutPlayer iOS deep link", () => {
    const url = buildExternalPlayerUrl(
      "outplayer",
      "https://example.com/video.mkv",
      "ios",
    );
    expect(url).toBe("outplayer://https://example.com/video.mkv");
  });

  test("builds VLC desktop deep link", () => {
    const url = buildExternalPlayerUrl(
      "vlc",
      "https://example.com/video.mkv",
      "desktop",
    );
    expect(url).toBe("vlc://https://example.com/video.mkv");
  });

  test("builds VLC android intent link", () => {
    const url = buildExternalPlayerUrl(
      "vlc",
      "https://example.com/video.mkv",
      "android",
    );
    expect(url).toBe(
      "intent://example.com/video.mkv#Intent;package=org.videolan.vlc;type=video;scheme=https;end",
    );
  });

  test("toAbsolutePlaybackUrl resolves relative proxy paths", () => {
    const originalLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { origin: "https://jedflix.example" },
    });

    expect(toAbsolutePlaybackUrl("/stream-api/api/v1/proxy/token")).toBe(
      "https://jedflix.example/stream-api/api/v1/proxy/token",
    );

    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  test("detectExternalPlayerPlatform identifies ios", () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
    });

    expect(detectExternalPlayerPlatform()).toBe("ios");

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  });
});

describe("userSettings externalPlayer", () => {
  afterEach(() => {
    clearUserSettings();
  });

  test("sanitizes externalPlayer values", () => {
    saveUserSettings({ externalPlayer: "vlc" });
    expect(getUserSettings().externalPlayer).toBe("vlc");

    saveUserSettings({ externalPlayer: "invalid" as "vlc" });
    expect(getUserSettings().externalPlayer).toBeUndefined();
  });

  test("defaults externalPlayer to undefined when unset", () => {
    expect(getUserSettings().externalPlayer).toBeUndefined();
  });
});
