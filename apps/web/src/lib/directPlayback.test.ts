import { describe, expect, test } from "bun:test";
import { isDirectPlaybackIncompatible } from "@jedflix/shared";

describe("directPlayback", () => {
  test("flags mkv remux and lossless audio as incompatible", () => {
    expect(isDirectPlaybackIncompatible("Movie.2024.2160p.REMUX.TrueHD.Atmos.mkv")).toBe(true);
    expect(isDirectPlaybackIncompatible("Movie.2024.1080p.BluRay.DTS-HD.mkv")).toBe(true);
    expect(isDirectPlaybackIncompatible("Movie.2024.1080p.WEBRip.x264.AAC.mp4")).toBe(false);
  });

  test("reads Comet's normalized audio summary", () => {
    expect(isDirectPlaybackIncompatible("Movie.2024.1080p.WEB.mp4 x264 | Dolby Digital Plus • 5.1")).toBe(true);
    expect(isDirectPlaybackIncompatible("Movie.2024.1080p.WEB.mp4 x264 • 8bit | AAC • 2.0")).toBe(false);
  });
});
