import { describe, expect, test } from "bun:test";
import {
  hasImportScopes,
  SPOTIFY_IMPORT_SCOPES,
  SPOTIFY_SCOPES,
} from "@convex/spotifyApi";
import {
  MAX_LIKED_SONGS,
  MAX_PLAYLIST_TRACKS,
  normalizeTrack,
} from "@convex/musicTrack";
import { spotifyTrackToPartyTrack } from "@convex/partyModel";

describe("spotify import scopes", () => {
  test("SPOTIFY_SCOPES includes library read scopes", () => {
    for (const scope of SPOTIFY_IMPORT_SCOPES) {
      expect(SPOTIFY_SCOPES.split(" ")).toContain(scope);
    }
  });

  test("hasImportScopes requires every import scope", () => {
    expect(hasImportScopes(SPOTIFY_SCOPES)).toBe(true);
    expect(hasImportScopes("user-read-private")).toBe(false);
    expect(
      hasImportScopes(
        "playlist-read-private playlist-read-collaborative user-library-read",
      ),
    ).toBe(true);
    expect(hasImportScopes(null)).toBe(false);
    expect(hasImportScopes(undefined)).toBe(false);
  });
});

describe("library size limits", () => {
  test("supports Spotify-scale libraries (10k+)", () => {
    expect(MAX_LIKED_SONGS).toBeGreaterThanOrEqual(10_000);
    expect(MAX_PLAYLIST_TRACKS).toBeGreaterThanOrEqual(10_000);
  });

  test("normalizeTrack trims fields", () => {
    const track = normalizeTrack({
      id: "  abcdefghijabcdefghij01  ",
      title: "  Song  ",
      artists: ["  A  ", ""],
      albumName: "  Album  ",
      imageUrl: " https://img  ",
      durationMs: 12.7,
    });
    expect(track.id).toBe("abcdefghijabcdefghij01");
    expect(track.title).toBe("Song");
    expect(track.artists).toEqual(["A"]);
    expect(track.durationMs).toBe(12);
  });
});

describe("spotify track mapping for import", () => {
  test("maps a Spotify Web API track payload", () => {
    const mapped = spotifyTrackToPartyTrack({
      id: "abcdefghijabcdefghij01",
      name: "Test Track",
      duration_ms: 210_000,
      artists: [{ id: "artist0000000000000001", name: "Artist" }],
      album: {
        id: "album000000000000000001",
        name: "Album",
        images: [{ url: "https://example.com/cover.jpg" }],
      },
    });
    expect(mapped).toEqual({
      id: "abcdefghijabcdefghij01",
      title: "Test Track",
      artists: ["Artist"],
      artistIds: ["artist0000000000000001"],
      albumName: "Album",
      albumId: "album000000000000000001",
      imageUrl: "https://example.com/cover.jpg",
      durationMs: 210_000,
    });
  });

  test("skips non-track payloads", () => {
    expect(spotifyTrackToPartyTrack(null)).toBeNull();
    expect(spotifyTrackToPartyTrack({ name: "no id" })).toBeNull();
  });
});
