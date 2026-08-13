export type SearchMode = "media" | "books" | "music";

/** Wait this long after typing before hitting remote search APIs. */
export const SEARCH_DEBOUNCE_MS = 500;

/** Music hybrid search is slower — wait longer so prefix keystrokes don't stack. */
export const MUSIC_SEARCH_DEBOUNCE_MS = 750;

/** Skip music API calls until the query has this many characters. */
export const MUSIC_SEARCH_MIN_CHARS = 3;

export function searchDebounceMs(mode: SearchMode): number {
  return mode === "music" ? MUSIC_SEARCH_DEBOUNCE_MS : SEARCH_DEBOUNCE_MS;
}

export function shouldLiveSearch(query: string, mode: SearchMode): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }
  if (mode === "music" && trimmed.length < MUSIC_SEARCH_MIN_CHARS) {
    return false;
  }
  return true;
}
