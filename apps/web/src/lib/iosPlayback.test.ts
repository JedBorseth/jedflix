import { describe, expect, test } from "bun:test";
import { scoreIosBrowserCompatibility, sortSourcesForIosPlayback } from "@/lib/iosPlayback";
import type { StreamSource } from "@/lib/streamApi";

describe("iosPlayback", () => {
  test("prefers web-dl x264 over remux", () => {
    const remuxScore = scoreIosBrowserCompatibility(
      "Movie.2024.2160p.UHD.BluRay.REMUX.HEVC.DTS-HD.MA.5.1.mkv",
    );
    const webdlScore = scoreIosBrowserCompatibility(
      "Movie.2024.1080p.WEB-DL.x264.AAC.mkv",
    );
    expect(webdlScore).toBeGreaterThan(remuxScore);
  });

  test("sortSourcesForIosPlayback reorders on iOS", () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
    });

    const sources: StreamSource[] = [
      {
        id: "remux",
        title: "Movie.2024.2160p.UHD.BluRay.REMUX.HEVC.DTS-HD.MA.5.1.mkv",
        magnet: "magnet:1",
      },
      {
        id: "webdl",
        title: "Movie.2024.1080p.WEB-DL.x264.AAC.mkv",
        magnet: "magnet:2",
      },
    ];

    const sorted = sortSourcesForIosPlayback(sources);
    expect(sorted[0]?.id).toBe("webdl");

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  });
});
