import { beforeEach, describe, expect, test } from "bun:test";
import {
  SUCCESSFUL_SEARCHES_LIMIT,
  SUCCESSFUL_SEARCHES_STORAGE_KEY,
  getSuccessfulSearchesSnapshot,
  loadSuccessfulSearches,
  recordSuccessfulSearch,
  resetSuccessfulSearchesCacheForTests,
  type SuccessfulSearchItem,
} from "@/lib/successfulSearches";

function movieItem(id: number): SuccessfulSearchItem {
  return {
    id: `media:movie:${id}`,
    kind: "movie",
    title: `Movie ${id}`,
    href: `/movie/${id}`,
  };
}

describe("successfulSearches", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSuccessfulSearchesCacheForTests();
  });

  test("records opened items newest first and caps the list", () => {
    for (let i = 0; i < 8; i++) {
      recordSuccessfulSearch("media", movieItem(i));
    }
    const list = loadSuccessfulSearches("media");
    expect(list).toHaveLength(SUCCESSFUL_SEARCHES_LIMIT);
    expect(list[0]?.id).toBe("media:movie:7");
    expect(loadSuccessfulSearches("books")).toEqual([]);
  });

  test("keeps opened items isolated by category", () => {
    recordSuccessfulSearch("media", movieItem(1));
    recordSuccessfulSearch("books", {
      id: "book:OL1W",
      kind: "book",
      title: "Dune",
      href: "/audiobook/OL1W",
    });
    recordSuccessfulSearch("music", {
      id: "artist:abc",
      kind: "artist",
      title: "Radiohead",
      href: "/music-artist/abc",
    });

    expect(loadSuccessfulSearches("media").map((item) => item.title)).toEqual(["Movie 1"]);
    expect(loadSuccessfulSearches("books").map((item) => item.title)).toEqual(["Dune"]);
    expect(loadSuccessfulSearches("music").map((item) => item.title)).toEqual(["Radiohead"]);
  });

  test("moves a repeated item to the front without duplicating", () => {
    recordSuccessfulSearch("media", movieItem(1));
    recordSuccessfulSearch("media", movieItem(2));
    recordSuccessfulSearch("media", movieItem(1));

    expect(loadSuccessfulSearches("media").map((item) => item.id)).toEqual([
      "media:movie:1",
      "media:movie:2",
    ]);
  });

  test("preserves track playback payloads", () => {
    recordSuccessfulSearch("music", {
      id: "track:t1",
      kind: "track",
      title: "Everything In Its Right Place",
      subtitle: "Radiohead · 4:11",
      imageUrl: "https://example.com/cover.jpg",
      track: {
        id: "t1",
        title: "Everything In Its Right Place",
        artists: ["Radiohead"],
        albumName: "Kid A",
        imageUrl: "https://example.com/cover.jpg",
        durationMs: 251_000,
      },
    });

    const [item] = loadSuccessfulSearches("music");
    expect(item?.track?.albumName).toBe("Kid A");
    expect(item?.track?.durationMs).toBe(251_000);
  });

  test("ignores invalid items and malformed storage", () => {
    recordSuccessfulSearch("media", { id: "", kind: "movie", title: "Nope" });
    recordSuccessfulSearch("media", { id: "x", kind: "movie", title: "No href" });
    recordSuccessfulSearch("media", movieItem(3));
    expect(loadSuccessfulSearches("media").map((item) => item.id)).toEqual([
      "media:movie:3",
    ]);

    window.localStorage.setItem(SUCCESSFUL_SEARCHES_STORAGE_KEY, "{not json");
    resetSuccessfulSearchesCacheForTests();
    expect(loadSuccessfulSearches("media")).toEqual([]);
  });

  test("getSnapshot returns a stable reference when storage is unchanged", () => {
    recordSuccessfulSearch("media", movieItem(1));
    const first = getSuccessfulSearchesSnapshot("media");
    const second = getSuccessfulSearchesSnapshot("media");
    expect(first).toBe(second);
  });
});
