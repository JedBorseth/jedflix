import { describe, expect, test } from "bun:test";
import { normalizeSpotifyId, pickRandomAlbum } from "@/lib/spotify";

describe("spotify helpers", () => {
  test("normalizeSpotifyId accepts Spotify ids and URIs", () => {
    expect(normalizeSpotifyId("4aawyAB9vmqN3uQ7FjRGTy")).toBe("4aawyAB9vmqN3uQ7FjRGTy");
    expect(normalizeSpotifyId("spotify:album:4aawyAB9vmqN3uQ7FjRGTy")).toBe(
      "4aawyAB9vmqN3uQ7FjRGTy",
    );
    expect(normalizeSpotifyId("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy?si=1")).toBe(
      "4aawyAB9vmqN3uQ7FjRGTy",
    );
    expect(normalizeSpotifyId("short")).toBeNull();
    expect(normalizeSpotifyId(null)).toBeNull();
  });

  test("pickRandomAlbum returns undefined for empty lists", () => {
    expect(pickRandomAlbum([])).toBeUndefined();
  });
});
