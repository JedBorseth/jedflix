import { describe, expect, test } from "bun:test";
import type { SpotifyTopTrack } from "@jedflix/stream-client";
import { infiniteQueueInternals } from "@/lib/infiniteQueueRecommendations";
import type { MusicQueueTrack } from "@/components/player/music/MusicPlayerContext";

const { buildSeeds, interleavePools, normalizeArtist } = infiniteQueueInternals;

function track(
  id: string,
  name: string,
  artists: string[],
): SpotifyTopTrack {
  return {
    id,
    name,
    artists,
    artistIds: [],
    trackNumber: 1,
    discNumber: 1,
    durationMs: 180000,
    explicit: false,
    albumId: "album",
    albumName: "Album",
    imageUrl: "https://example.com/cover.jpg",
  };
}

function queueTrack(id: string, title: string, artists: string[]): MusicQueueTrack {
  return {
    id,
    title,
    artists,
    albumName: "Album",
    imageUrl: "https://example.com/cover.jpg",
    durationMs: 180000,
  };
}

describe("infiniteQueueRecommendations helpers", () => {
  test("buildSeeds prefers current then recent unique tracks", () => {
    const current = queueTrack("1", "Song A", ["Artist A"]);
    const recent = [
      queueTrack("1", "Song A", ["Artist A"]),
      queueTrack("2", "Song B", ["Artist B"]),
      queueTrack("3", "Song C", ["Artist C"]),
    ];
    const seeds = buildSeeds(current, recent);
    expect(seeds.map((seed) => seed.title)).toEqual(["Song A", "Song B", "Song C"]);
  });

  test("interleavePools mixes similar and explore without duplicates", () => {
    const similar = [
      track("s1", "S1", ["A"]),
      track("s2", "S2", ["A"]),
      track("s3", "S3", ["A"]),
      track("s4", "S4", ["A"]),
    ];
    const explore = [
      track("s2", "S2", ["A"]),
      track("e1", "E1", ["B"]),
      track("e2", "E2", ["C"]),
    ];
    const mixed = interleavePools(similar, explore);
    expect(mixed.map((item) => item.id)).toEqual(["s1", "s2", "s3", "e1", "s4", "e2"]);
  });

  test("normalizeArtist lowercases and trims", () => {
    expect(normalizeArtist("  Radiohead ")).toBe("radiohead");
  });
});
