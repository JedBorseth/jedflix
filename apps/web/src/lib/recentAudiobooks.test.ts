import { describe, expect, test, beforeEach } from "bun:test";
import {
  getRecentAudiobook,
  getRecentAudiobooksSnapshot,
  hasContinueProgress,
  loadRecentAudiobooks,
  recordRecentAudiobook,
  resetRecentAudiobooksCacheForTests,
  saveRecentAudiobookProgress,
  saveRecentAudiobookStream,
  toSavedAudiobookStream,
  toStreamSource,
} from "@/lib/recentAudiobooks";

describe("recentAudiobooks", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRecentAudiobooksCacheForTests();
  });

  test("records unique books newest first and caps at 24", () => {
    for (let i = 0; i < 30; i++) {
      recordRecentAudiobook({
        id: `OL${i}W`,
        title: `Book ${i}`,
        coverUrl: "https://example.com/a.jpg",
        authors: ["Author"],
      });
    }
    const list = loadRecentAudiobooks();
    expect(list).toHaveLength(24);
    expect(list[0]?.id).toBe("OL29W");
    expect(list[23]?.id).toBe("OL6W");
  });

  test("preserves selected stream and progress across reopen", () => {
    recordRecentAudiobook({
      id: "OL1W",
      title: "Dune",
      coverUrl: "https://example.com/dune.jpg",
      authors: ["Herbert"],
    });
    saveRecentAudiobookStream("OL1W", {
      id: "abb_0",
      title: "Dune M4B",
      magnet: "magnet:?xt=urn:btih:abc",
      abbPostUrl: "https://audiobookbay.lu/abss/dune/",
    });
    saveRecentAudiobookProgress("OL1W", { fileIndex: 2, positionSec: 120 });

    recordRecentAudiobook({
      id: "OL1W",
      title: "Dune",
      coverUrl: "https://example.com/dune.jpg",
      authors: ["Herbert"],
    });

    const entry = getRecentAudiobook("OL1W");
    expect(entry?.selectedStream?.id).toBe("abb_0");
    expect(entry?.fileIndex).toBe(2);
    expect(entry?.progressSeconds).toBe(120);
    expect(hasContinueProgress(entry)).toBe(true);
  });

  test("toStreamSource round-trips saved stream", () => {
    const saved = toSavedAudiobookStream({
      id: "abb_1",
      title: "Title",
      magnet: "magnet:?xt=urn:btih:def",
      seeders: 2,
      abbPostUrl: "https://example.com/post",
    });
    expect(toStreamSource(saved)).toEqual({
      id: "abb_1",
      title: "Title",
      magnet: "magnet:?xt=urn:btih:def",
      seeders: 2,
      abbPostUrl: "https://example.com/post",
      infoHash: undefined,
      sizeGb: undefined,
      cached: undefined,
      info: undefined,
      matchScore: undefined,
    });
  });

  test("getSnapshot returns a stable reference when storage is unchanged", () => {
    recordRecentAudiobook({
      id: "OL9W",
      title: "Stable",
      coverUrl: "https://example.com/a.jpg",
      authors: ["A"],
    });
    const first = getRecentAudiobooksSnapshot();
    const second = getRecentAudiobooksSnapshot();
    expect(first).toBe(second);
  });
});
