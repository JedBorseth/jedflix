import { afterEach, describe, expect, test } from "bun:test";
import type { MediaItem } from "@/lib/types";
import { isRDBlockedFilename } from "@/lib/rdBlocked";
import {
  clearUserSettings,
  getUserSettings,
  saveUserSettings,
  subscribeUserSettings,
} from "@/lib/userSettings";
import {
  buildContinueListeningItems,
  buildContinueWatchingItems,
  buildRecentlyWatchedItems,
  mediaKey,
} from "@/lib/watchHistory";

const movie: MediaItem = {
  id: 1,
  mediaType: "movie",
  title: "Example",
  description: "Desc",
  posterUrl: "https://example.com/poster.jpg",
  backdropUrl: "https://example.com/backdrop.jpg",
  year: 2024,
  releaseDate: "2024-01-01",
  rating: "PG-13",
  durationMinutes: 100,
};

describe("watchHistory helpers", () => {
  test("buildContinueWatchingItems keeps in-progress titles", () => {
    const items = buildContinueWatchingItems(
      [
        {
          movieId: 1,
          mediaType: "movie",
          progressSeconds: 600,
          lastWatchedAt: 10,
        },
      ],
      [movie],
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.media.title).toBe("Example");
  });

  test("buildContinueWatchingItems excludes finished titles", () => {
    const items = buildContinueWatchingItems(
      [
        {
          movieId: 1,
          mediaType: "movie",
          progressSeconds: 5400,
          lastWatchedAt: 10,
        },
      ],
      [movie],
    );

    expect(items).toHaveLength(0);
  });

  test("buildRecentlyWatchedItems excludes continue watching titles", () => {
    const history = [
      {
        movieId: 1,
        mediaType: "movie" as const,
        progressSeconds: 600,
        lastWatchedAt: 20,
      },
      {
        movieId: 2,
        mediaType: "movie" as const,
        progressSeconds: 5400,
        lastWatchedAt: 10,
      },
    ];

    const mediaItems = [
      movie,
      { ...movie, id: 2, title: "Finished" },
    ];

    const continueItems = buildContinueWatchingItems(history, mediaItems);
    const continueKeys = new Set(
      continueItems.map((item) => mediaKey(item.mediaType, item.movieId!)),
    );
    const recentItems = buildRecentlyWatchedItems(history, mediaItems, continueKeys);

    expect(continueItems).toHaveLength(1);
    expect(recentItems).toHaveLength(1);
    expect(recentItems[0]?.media.title).toBe("Finished");
  });

  test("buildContinueListeningItems keeps in-progress audiobooks", () => {
    const items = buildContinueListeningItems(
      [
        {
          workId: "OL1W",
          mediaType: "audiobook",
          progressSeconds: 120,
          fileIndex: 2,
          lastWatchedAt: 10,
        },
      ],
      [
        {
          id: "OL1W",
          title: "Example Book",
          coverUrl: "https://example.com/cover.jpg",
          authors: ["Author"],
        },
      ],
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.book.title).toBe("Example Book");
    expect(items[0]?.fileIndex).toBe(2);
  });
});

describe("streaming settings helpers", () => {
  afterEach(() => {
    localStorage.clear();
  });

  test("matches Real Debrid infringing filename patterns without broadening them", () => {
    expect(isRDBlockedFilename("Movie.2024.1080p.WEB-DL.DDP5.1")).toBe(true);
    expect(isRDBlockedFilename("Movie.2024.1080p.BluRay.x264-GROUP")).toBe(true);
    expect(isRDBlockedFilename("Show.S01E01.HDTV.XviD-GROUP")).toBe(true);
    expect(isRDBlockedFilename("Movie.2024.1080p.WEB-Rip.x265")).toBe(false);
    expect(isRDBlockedFilename("Movie.2024.1080p.Blu-Ray.x264-GROUP")).toBe(false);
    expect(isRDBlockedFilename("Movie.2024.1080p.Remux.HEVC")).toBe(false);
  });

  test("clears legacy stream mode storage", () => {
    localStorage.setItem("jedflix.streamMode", "direct");

    const settings = getUserSettings();

    expect(settings).toEqual({});
    expect(localStorage.getItem("jedflix.streamMode")).toBeNull();
  });

  test("merges partial settings without dropping other fields", () => {
    saveUserSettings({ externalPlayer: "vlc", realDebridApiKey: "rd-key" });
    const next = saveUserSettings({ externalPlayer: "outplayer" });

    expect(next).toMatchObject({
      externalPlayer: "outplayer",
      realDebridApiKey: "rd-key",
    });
  });

  test("clears settings and notifies subscribers", () => {
    saveUserSettings({ externalPlayer: "vlc", realDebridApiKey: "rd-key" });
    let notified = false;
    const unsubscribe = subscribeUserSettings(() => {
      notified = true;
    });

    clearUserSettings();
    unsubscribe();

    expect(getUserSettings()).toEqual({});
    expect(notified).toBe(true);
  });
});
