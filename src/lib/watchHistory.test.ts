import { describe, expect, test } from "bun:test";
import type { MediaItem } from "@/lib/types";
import {
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
      continueItems.map((item) => mediaKey(item.mediaType, item.movieId)),
    );
    const recentItems = buildRecentlyWatchedItems(history, mediaItems, continueKeys);

    expect(continueItems).toHaveLength(1);
    expect(recentItems).toHaveLength(1);
    expect(recentItems[0]?.media.title).toBe("Finished");
  });
});
