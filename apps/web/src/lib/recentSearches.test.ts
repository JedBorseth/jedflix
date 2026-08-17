import { describe, expect, test, beforeEach } from "bun:test";
import {
  RECENT_SEARCHES_LIMIT,
  getRecentSearchesSnapshot,
  loadRecentSearches,
  recordRecentSearch,
  resetRecentSearchesCacheForTests,
} from "@/lib/recentSearches";

describe("recentSearches", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetRecentSearchesCacheForTests();
  });

  test("records unique queries newest first and caps at 5 per category", () => {
    for (let i = 0; i < 8; i++) {
      recordRecentSearch("media", `Query ${i}`);
    }
    const list = loadRecentSearches("media");
    expect(list).toHaveLength(RECENT_SEARCHES_LIMIT);
    expect(list[0]).toBe("Query 7");
    expect(list[4]).toBe("Query 3");
    expect(loadRecentSearches("books")).toEqual([]);
  });

  test("keeps searches isolated by media category", () => {
    recordRecentSearch("media", "Inception");
    recordRecentSearch("books", "Dune");
    recordRecentSearch("music", "Radiohead");

    expect(loadRecentSearches("media")).toEqual(["Inception"]);
    expect(loadRecentSearches("books")).toEqual(["Dune"]);
    expect(loadRecentSearches("music")).toEqual(["Radiohead"]);
  });

  test("moves a repeated search to the front without duplicating", () => {
    recordRecentSearch("media", "The Office");
    recordRecentSearch("media", "Severance");
    recordRecentSearch("media", "the office");

    expect(loadRecentSearches("media")).toEqual(["the office", "Severance"]);
  });

  test("ignores blank queries", () => {
    recordRecentSearch("media", "   ");
    recordRecentSearch("media", "Barbie");
    expect(getRecentSearchesSnapshot("media")).toEqual(["Barbie"]);
  });

  test("getSnapshot returns a stable reference when storage is unchanged", () => {
    recordRecentSearch("media", "Dune");
    const first = getRecentSearchesSnapshot("media");
    const second = getRecentSearchesSnapshot("media");
    expect(first).toBe(second);
  });
});
