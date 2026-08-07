import { describe, expect, test } from "bun:test";
import { normalizeSpotifyId, pickRandomAlbum, formatTrackDuration } from "@/lib/spotify";

describe("spotify helpers", () => {
  test("normalizeSpotifyId accepts Spotify ids, URIs, and MusicBrainz MBIDs", () => {
    expect(normalizeSpotifyId("4aawyAB9vmqN3uQ7FjRGTy")).toBe("4aawyAB9vmqN3uQ7FjRGTy");
    expect(normalizeSpotifyId("spotify:album:4aawyAB9vmqN3uQ7FjRGTy")).toBe(
      "4aawyAB9vmqN3uQ7FjRGTy",
    );
    expect(normalizeSpotifyId("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?si=1")).toBe(
      "4aawyAB9vmqN3uQ7FjRGTy",
    );
    expect(normalizeSpotifyId("a74b1b7f-71a5-4011-9441-d0b5e4122711")).toBe(
      "a74b1b7f-71a5-4011-9441-d0b5e4122711",
    );
    expect(normalizeSpotifyId("https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711")).toBe(
      "a74b1b7f-71a5-4011-9441-d0b5e4122711",
    );
    expect(normalizeSpotifyId("short")).toBeNull();
    expect(normalizeSpotifyId(null)).toBeNull();
  });

  test("pickRandomAlbum returns undefined for empty lists", () => {
    expect(pickRandomAlbum([])).toBeUndefined();
  });

  test("formatTrackDuration formats mm:ss", () => {
    expect(formatTrackDuration(0)).toBe("0:00");
    expect(formatTrackDuration(65_000)).toBe("1:05");
    expect(formatTrackDuration(3_600_000)).toBe("60:00");
  });
});
