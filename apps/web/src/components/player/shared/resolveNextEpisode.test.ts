import { describe, expect, test } from "bun:test";
import type { TvSeasonSummary } from "@/lib/tmdb";
import {
  isInNextEpisodeWindow,
  resolveNextEpisode,
} from "./resolveNextEpisode";

const seasons: TvSeasonSummary[] = [
  { seasonNumber: 1, name: "Season 1", episodeCount: 3 },
  { seasonNumber: 2, name: "Season 2", episodeCount: 2 },
];

describe("resolveNextEpisode", () => {
  test("returns next episode in the same season", () => {
    expect(resolveNextEpisode(seasons, 1, 1)).toEqual({
      season: 1,
      episode: 2,
      label: "Next Episode",
    });
  });

  test("labels season finale when next is last of a non-final season", () => {
    expect(resolveNextEpisode(seasons, 1, 2)).toEqual({
      season: 1,
      episode: 3,
      label: "Season 1 Finale",
    });
  });

  test("advances to the first episode of the next season", () => {
    expect(resolveNextEpisode(seasons, 1, 3)).toEqual({
      season: 2,
      episode: 1,
      label: "Next Episode",
    });
  });

  test("labels final episode when next is the series finale", () => {
    expect(resolveNextEpisode(seasons, 2, 1)).toEqual({
      season: 2,
      episode: 2,
      label: "Final Episode",
    });
  });

  test("returns null on the last episode of the series", () => {
    expect(resolveNextEpisode(seasons, 2, 2)).toBeNull();
  });

  test("returns null for unknown season", () => {
    expect(resolveNextEpisode(seasons, 9, 1)).toBeNull();
  });
});

describe("isInNextEpisodeWindow", () => {
  test("is true in the last minute", () => {
    expect(isInNextEpisodeWindow(540_000, 600_000)).toBe(true);
  });

  test("is false earlier than the last minute", () => {
    expect(isInNextEpisodeWindow(500_000, 600_000)).toBe(false);
  });
});
