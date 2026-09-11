import { describe, expect, test, beforeEach } from "bun:test";
import {
  compactAudiobookMagnet,
  getRecentAudiobook,
  getRecentAudiobooksSnapshot,
  hasContinueProgress,
  hasKnownGoodAudiobookStream,
  hasPlayableAudiobookMagnet,
  hasSavedAudiobookStream,
  findSavedAudiobookSource,
  playbackSourceFromSaved,
  prependLastUsedAudiobookSource,
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
    expect(hasKnownGoodAudiobookStream(entry)).toBe(true);
    expect(hasSavedAudiobookStream(entry?.selectedStream)).toBe(true);
  });

  test("hasSavedAudiobookStream is false without magnet, post url, or hash", () => {
    expect(hasSavedAudiobookStream(undefined)).toBe(false);
    expect(hasSavedAudiobookStream({ id: "abb_0", title: "Nope" })).toBe(false);
    expect(
      hasKnownGoodAudiobookStream({
        selectedStreamId: "abb_0",
        selectedStreamTitle: "Nope",
      }),
    ).toBe(false);
  });

  test("findSavedAudiobookSource prefers abb post url then hash", () => {
    const sources = [
      { id: "abb_0", title: "Stale id", magnet: "", abbPostUrl: "https://abb/other" },
      { id: "abb_2", title: "Dune", magnet: "", abbPostUrl: "https://abb/dune", infoHash: "abc" },
    ];
    expect(
      findSavedAudiobookSource(sources, {
        id: "abb_0",
        abbPostUrl: "https://abb/dune",
      })?.id,
    ).toBe("abb_2");
    expect(findSavedAudiobookSource(sources, { infoHash: "ABC" })?.id).toBe("abb_2");
  });

  test("findSavedAudiobookSource overlays the saved magnet onto a search hit", () => {
    const hash = "a".repeat(40);
    const sources = [
      { id: "abb_2", title: "Dune", magnet: "", abbPostUrl: "https://abb/dune" },
    ];
    const matched = findSavedAudiobookSource(sources, {
      abbPostUrl: "https://abb/dune",
      magnet: `magnet:?xt=urn:btih:${hash}&dn=Dune`,
    });
    expect(matched?.magnet).toBe(`magnet:?xt=urn:btih:${hash}`);
    expect(matched?.infoHash).toBe(hash);
  });

  test("compactAudiobookMagnet keeps a hash-only magnet for Real Debrid", () => {
    const hash = "b".repeat(40);
    expect(
      compactAudiobookMagnet(`magnet:?xt=urn:btih:${hash}&tr=udp://tracker.example/announce`),
    ).toEqual({
      magnet: `magnet:?xt=urn:btih:${hash}`,
      infoHash: hash,
    });
    expect(hasPlayableAudiobookMagnet({ magnet: `magnet:?xt=urn:btih:${hash}` })).toBe(true);
    expect(hasPlayableAudiobookMagnet({ magnet: "", infoHash: "" })).toBe(false);
  });

  test("playbackSourceFromSaved prefers a local magnet over an empty Convex row", () => {
    const hash = "c".repeat(40);
    const source = playbackSourceFromSaved(
      {
        id: "abb_0",
        title: "Dune M4B",
        magnet: `magnet:?xt=urn:btih:${hash}&dn=Dune`,
        abbPostUrl: "https://abb/dune",
      },
      {
        selectedStreamId: "abb_0",
        selectedStreamTitle: "Dune M4B",
        selectedStreamMagnet: "",
        selectedStreamAbbPostUrl: "https://abb/dune",
      },
    );
    expect(source?.magnet).toBe(`magnet:?xt=urn:btih:${hash}`);
    expect(source?.infoHash).toBe(hash);
  });

  test("prependLastUsedAudiobookSource puts the saved stream first", () => {
    const sources = [
      { id: "abb_1", title: "Other", magnet: "" },
      { id: "abb_0", title: "Dune M4B", magnet: "magnet:x" },
    ];
    const ordered = prependLastUsedAudiobookSource(sources, sources[1]);
    expect(ordered.map((source) => source.id)).toEqual(["abb_0", "abb_1"]);
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
