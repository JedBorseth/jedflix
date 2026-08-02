import { describe, expect, test } from "bun:test";
import {
  hasSavedStream,
  matchSavedStream,
  streamPreferenceFromSource,
} from "./savedStream";
import type { StreamSource } from "./streamApi";

const sources: StreamSource[] = [
  {
    id: "abb_0",
    title: "Book A",
    magnet: "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    abbPostUrl: "https://audiobookbay.lu/abss/a/",
    infoHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  {
    id: "abb_1",
    title: "Book B",
    magnet: "magnet:?xt=urn:btih:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    abbPostUrl: "https://audiobookbay.lu/abss/b/",
  },
];

describe("savedStream", () => {
  test("hasSavedStream detects preference fields", () => {
    expect(hasSavedStream(null)).toBe(false);
    expect(hasSavedStream({})).toBe(false);
    expect(hasSavedStream({ streamAbbPostUrl: "https://x" })).toBe(true);
  });

  test("matchSavedStream prefers abb post url from list", () => {
    const matched = matchSavedStream(sources, {
      streamAbbPostUrl: "https://audiobookbay.lu/abss/b/",
    });
    expect(matched?.id).toBe("abb_1");
  });

  test("matchSavedStream reconstructs when missing from search", () => {
    const matched = matchSavedStream(sources, {
      streamAbbPostUrl: "https://audiobookbay.lu/abss/old/",
      streamTitle: "Old Pack",
      streamMagnet: "magnet:?xt=urn:btih:cccccccccccccccccccccccccccccccccccccccc",
    });
    expect(matched?.id).toBe("saved-stream");
    expect(matched?.title).toBe("Old Pack");
    expect(matched?.abbPostUrl).toBe("https://audiobookbay.lu/abss/old/");
  });

  test("streamPreferenceFromSource maps source fields", () => {
    expect(streamPreferenceFromSource(sources[0]!)).toEqual({
      streamAbbPostUrl: sources[0]!.abbPostUrl,
      streamMagnet: sources[0]!.magnet,
      streamInfoHash: sources[0]!.infoHash,
      streamTitle: sources[0]!.title,
    });
  });
});
