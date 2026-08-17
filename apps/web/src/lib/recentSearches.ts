import type { SearchMode } from "@/lib/searchDebounce";

export const RECENT_SEARCHES_LIMIT = 5;
export const RECENT_SEARCHES_STORAGE_KEY = "jedflix.search.recent";
export const RECENT_SEARCHES_EVENT = "jedflix-search-recent";

export type RecentSearchCategory = SearchMode;

type RecentSearchStore = Record<RecentSearchCategory, string[]>;

const EMPTY_MEDIA: string[] = [];
const EMPTY_BOOKS: string[] = [];
const EMPTY_MUSIC: string[] = [];

const EMPTY_BY_CATEGORY: RecentSearchStore = {
  media: EMPTY_MEDIA,
  books: EMPTY_BOOKS,
  music: EMPTY_MUSIC,
};

const EMPTY_STORE: RecentSearchStore = {
  media: EMPTY_MEDIA,
  books: EMPTY_BOOKS,
  music: EMPTY_MUSIC,
};

let cachedRaw: string | null = null;
let cachedStore: RecentSearchStore = EMPTY_STORE;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emptyList(category: RecentSearchCategory): string[] {
  return EMPTY_BY_CATEGORY[category];
}

function isSearchCategory(value: string): value is RecentSearchCategory {
  return value === "media" || value === "books" || value === "music";
}

function sanitizeQueries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    queries.push(trimmed);
    if (queries.length >= RECENT_SEARCHES_LIMIT) {
      break;
    }
  }
  return queries;
}

function parseStore(raw: string | null): RecentSearchStore {
  if (!raw) {
    return EMPTY_STORE;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return EMPTY_STORE;
    }
    const record = parsed as Record<string, unknown>;
    const store: RecentSearchStore = {
      media: sanitizeQueries(record.media),
      books: sanitizeQueries(record.books),
      music: sanitizeQueries(record.music),
    };
    if (store.media.length === 0 && store.books.length === 0 && store.music.length === 0) {
      return EMPTY_STORE;
    }
    if (store.media.length === 0) {
      store.media = EMPTY_MEDIA;
    }
    if (store.books.length === 0) {
      store.books = EMPTY_BOOKS;
    }
    if (store.music.length === 0) {
      store.music = EMPTY_MUSIC;
    }
    return store;
  } catch {
    return EMPTY_STORE;
  }
}

function readStore(): RecentSearchStore {
  if (!canUseStorage()) {
    return EMPTY_STORE;
  }
  const raw = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
  if (raw === cachedRaw) {
    return cachedStore;
  }
  cachedRaw = raw;
  cachedStore = parseStore(raw);
  return cachedStore;
}

function writeStore(store: RecentSearchStore): RecentSearchStore {
  if (!canUseStorage()) {
    return EMPTY_STORE;
  }
  const next: RecentSearchStore = {
    media: store.media.length > 0 ? store.media : EMPTY_MEDIA,
    books: store.books.length > 0 ? store.books : EMPTY_BOOKS,
    music: store.music.length > 0 ? store.music : EMPTY_MUSIC,
  };
  const serialized = JSON.stringify({
    media: next.media,
    books: next.books,
    music: next.music,
  });
  try {
    window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, serialized);
  } catch {
    // Quota / private mode — ignore.
  }
  cachedRaw = serialized;
  cachedStore = next;
  notifyRecentSearchesChanged();
  return next;
}

export function getRecentSearchesSnapshot(category: RecentSearchCategory): string[] {
  const list = readStore()[category];
  return list.length > 0 ? list : emptyList(category);
}

export function loadRecentSearches(category: RecentSearchCategory): string[] {
  return getRecentSearchesSnapshot(category);
}

export function recordRecentSearch(
  category: RecentSearchCategory,
  query: string,
): string[] {
  if (!isSearchCategory(category)) {
    return emptyList("media");
  }
  const trimmed = query.trim();
  if (!trimmed) {
    return getRecentSearchesSnapshot(category);
  }

  const store = readStore();
  const current = store[category];
  const key = trimmed.toLowerCase();
  const nextList = [
    trimmed,
    ...current.filter((entry) => entry.toLowerCase() !== key),
  ].slice(0, RECENT_SEARCHES_LIMIT);

  writeStore({
    ...store,
    [category]: nextList,
  });
  return nextList;
}

export function notifyRecentSearchesChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(RECENT_SEARCHES_EVENT));
}

export function subscribeRecentSearches(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(RECENT_SEARCHES_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(RECENT_SEARCHES_EVENT, handler);
  };
}

/** Test helper — clears in-memory snapshot cache. */
export function resetRecentSearchesCacheForTests() {
  cachedRaw = null;
  cachedStore = EMPTY_STORE;
}
