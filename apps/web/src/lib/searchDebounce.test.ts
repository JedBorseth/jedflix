import { describe, expect, test } from "bun:test";
import {
  MUSIC_SEARCH_DEBOUNCE_MS,
  MUSIC_SEARCH_MIN_CHARS,
  SEARCH_DEBOUNCE_MS,
  searchDebounceMs,
  shouldLiveSearch,
} from "@/lib/searchDebounce";

describe("search debounce helpers", () => {
  test("music waits longer than media/books", () => {
    expect(searchDebounceMs("media")).toBe(SEARCH_DEBOUNCE_MS);
    expect(searchDebounceMs("books")).toBe(SEARCH_DEBOUNCE_MS);
    expect(searchDebounceMs("music")).toBe(MUSIC_SEARCH_DEBOUNCE_MS);
    expect(MUSIC_SEARCH_DEBOUNCE_MS).toBeGreaterThan(SEARCH_DEBOUNCE_MS);
  });

  test("music live search requires a minimum query length", () => {
    expect(MUSIC_SEARCH_MIN_CHARS).toBe(3);
    expect(shouldLiveSearch("", "music")).toBe(false);
    expect(shouldLiveSearch("th", "music")).toBe(false);
    expect(shouldLiveSearch("the", "music")).toBe(true);
    expect(shouldLiveSearch("hi", "media")).toBe(true);
    expect(shouldLiveSearch("  hip  ", "music")).toBe(true);
  });
});
