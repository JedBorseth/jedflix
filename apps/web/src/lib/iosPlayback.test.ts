import { describe, expect, test } from "bun:test";
import {
  prepareBrowserSources,
  scoreDirectPlaybackCompatibility,
} from "@/lib/iosPlayback";
import type { StreamSource } from "@/lib/streamApi";

describe("iosPlayback", () => {
  test("prefers mp4 aac over remux", () => {
    const remuxScore = scoreDirectPlaybackCompatibility(
      "Movie.2024.2160p.UHD.BluRay.REMUX.HEVC.DTS-HD.MA.5.1.mkv",
    );
    const mp4Score = scoreDirectPlaybackCompatibility(
      "Movie.2024.1080p.WEBRip.x264.AAC.mp4",
    );
    expect(mp4Score).toBeGreaterThan(remuxScore);
  });

  test("prepareBrowserSources filters incompatible releases", () => {
    const sources: StreamSource[] = [
      {
        id: "remux",
        title: "Movie.2024.2160p.UHD.BluRay.REMUX.HEVC.DTS-HD.MA.5.1.mkv",
        magnet: "magnet:1",
      },
      {
        id: "mp4",
        title: "Movie.2024.1080p.WEBRip.x264.AAC.mp4",
        magnet: "magnet:2",
        cached: true,
      },
    ];

    const prepared = prepareBrowserSources(sources);
    expect(prepared.map((source) => source.id)).toEqual(["mp4"]);
  });
});
