import { describe, expect, test } from "bun:test";
import {
  filterDirectPlaybackSources,
  isDirectPlaybackIncompatible,
  scoreDirectPlaybackCompatibility,
} from "@jedflix/shared";

describe("directPlayback", () => {
  test("flags mkv remux and lossless audio as incompatible", () => {
    expect(isDirectPlaybackIncompatible("Movie.2024.2160p.REMUX.TrueHD.Atmos.mkv")).toBe(true);
    expect(isDirectPlaybackIncompatible("Movie.2024.1080p.BluRay.DTS-HD.mkv")).toBe(true);
    expect(isDirectPlaybackIncompatible("Movie.2024.1080p.WEBRip.x264.AAC.mp4")).toBe(false);
  });

  test("scores compatible releases higher", () => {
    const compatible = scoreDirectPlaybackCompatibility("Movie.2024.1080p.WEBRip.x264.AAC.mp4");
    const hostile = scoreDirectPlaybackCompatibility("Movie.2024.2160p.REMUX.Atmos.mkv");
    expect(compatible).toBeGreaterThan(hostile);
  });

  test("filters incompatible sources", () => {
    const filtered = filterDirectPlaybackSources([
      { title: "Movie.2024.1080p.WEBRip.x264.AAC.mp4" },
      { title: "Movie.2024.2160p.REMUX.Atmos.mkv" },
    ]);
    expect(filtered).toEqual([{ title: "Movie.2024.1080p.WEBRip.x264.AAC.mp4" }]);
  });
});
