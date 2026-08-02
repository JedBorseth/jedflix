import { describe, expect, test } from "bun:test";
import {
  loadRecentlyPlayedMusic,
  recordRecentlyPlayedMusic,
} from "@/lib/recentlyPlayedMusic";

describe("recentlyPlayedMusic", () => {
  test("records unique tracks newest first and caps at 12", () => {
    window.localStorage.clear();
    for (let i = 0; i < 15; i++) {
      recordRecentlyPlayedMusic({
        id: `id-${i}`,
        title: `Song ${i}`,
        artists: ["Artist"],
        albumName: "Album",
        imageUrl: "https://example.com/a.jpg",
        durationMs: 180_000,
      });
    }
    const list = loadRecentlyPlayedMusic();
    expect(list).toHaveLength(12);
    expect(list[0]?.id).toBe("id-14");
    expect(list[11]?.id).toBe("id-3");
  });

  test("moves replayed track to the front", () => {
    window.localStorage.clear();
    recordRecentlyPlayedMusic({
      id: "a",
      title: "A",
      artists: ["X"],
      albumName: "Alb",
      imageUrl: "https://example.com/a.jpg",
      durationMs: 1000,
    });
    recordRecentlyPlayedMusic({
      id: "b",
      title: "B",
      artists: ["Y"],
      albumName: "Alb",
      imageUrl: "https://example.com/b.jpg",
      durationMs: 1000,
    });
    recordRecentlyPlayedMusic({
      id: "a",
      title: "A",
      artists: ["X"],
      albumName: "Alb",
      imageUrl: "https://example.com/a.jpg",
      durationMs: 1000,
    });
    const list = loadRecentlyPlayedMusic();
    expect(list.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
