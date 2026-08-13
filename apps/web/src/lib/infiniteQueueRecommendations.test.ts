import { describe, expect, test } from "bun:test";
import type { SpotifyTopTrack } from "@jedflix/stream-client";
import {
  exclusionIdsFromTracks,
  infiniteQueueInternals,
  remainingUpcomingCount,
  shouldAppendInfiniteRecommendations,
  uniqueQueueTracks,
} from "@/lib/infiniteQueueRecommendations";
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

describe("infinite queue preview helpers", () => {
  test("remainingUpcomingCount counts songs after the current index", () => {
    expect(remainingUpcomingCount(1, 0)).toBe(0);
    expect(remainingUpcomingCount(6, 0)).toBe(5);
    expect(remainingUpcomingCount(6, 4)).toBe(1);
  });

  test("shouldAppendInfiniteRecommendations is true when the queue is low", () => {
    expect(shouldAppendInfiniteRecommendations(0)).toBe(true);
    expect(shouldAppendInfiniteRecommendations(4)).toBe(true);
    expect(shouldAppendInfiniteRecommendations(5)).toBe(false);
  });

  test("exclusionIdsFromTracks unions queue, preview, and history ids", () => {
    const ids = exclusionIdsFromTracks(
      [queueTrack("1", "A", ["X"])],
      [queueTrack("2", "B", ["Y"]), null],
      [queueTrack("1", "A", ["X"])],
    );
    expect([...ids].sort()).toEqual(["1", "2"]);
  });

  test("uniqueQueueTracks drops ids and title+artist duplicates already in the queue", () => {
    const existing = [queueTrack("1", "Karma Police", ["Radiohead"])];
    const incoming = [
      queueTrack("1", "Karma Police", ["Radiohead"]),
      queueTrack("2", "Karma Police", ["Radiohead"]),
      queueTrack("3", "Paranoid Android", ["Radiohead"]),
      queueTrack("4", "Exit Music", ["Radiohead"]),
    ];
    const unique = uniqueQueueTracks(incoming, ["1"], 5, existing);
    expect(unique.map((track) => track.id)).toEqual(["3", "4"]);
  });

  test("uniqueQueueTracks respects the preview limit", () => {
    const incoming = [
      queueTrack("a", "A", ["One"]),
      queueTrack("b", "B", ["Two"]),
      queueTrack("c", "C", ["Three"]),
    ];
    expect(uniqueQueueTracks(incoming, [], 2).map((track) => track.id)).toEqual(["a", "b"]);
  });
});
