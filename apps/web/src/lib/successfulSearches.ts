import type { SearchMode } from "@/lib/searchDebounce";

export const SUCCESSFUL_SEARCHES_LIMIT = 5;
export const SUCCESSFUL_SEARCHES_STORAGE_KEY = "jedflix.search.successful.v1";
export const SUCCESSFUL_SEARCHES_EVENT = "jedflix-search-successful";

export type SuccessfulSearchCategory = SearchMode;

export type SuccessfulSearchKind =
  | "movie"
  | "show"
  | "person"
  | "book"
  | "author"
  | "track"
  | "album"
  | "artist";

export type SuccessfulSearchTrack = {
  id: string;
  title: string;
  artists: string[];
  artistIds?: string[];
  albumName: string;
  albumId?: string;
  imageUrl: string;
  durationMs: number;
  youtubeVideoId?: string;
};

export type SuccessfulSearchItem = {
  /** Stable dedupe key, e.g. "media:movie:123". */
  id: string;
  kind: SuccessfulSearchKind;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  /** Navigation target for every kind except tracks. */
  href?: string;
  /** Playback payload for click-to-play track results. */
  track?: SuccessfulSearchTrack;
};

const KIND_LABELS: Record<SuccessfulSearchKind, string> = {
  movie: "Movie",
  show: "TV Show",
  person: "Person",
  book: "Book",
  author: "Author",
  track: "Song",
  album: "Album",
  artist: "Artist",
};

const KINDS = Object.keys(KIND_LABELS) as SuccessfulSearchKind[];

export function successfulSearchKindLabel(kind: SuccessfulSearchKind): string {
  return KIND_LABELS[kind];
}

type SuccessfulSearchStore = Record<SuccessfulSearchCategory, SuccessfulSearchItem[]>;

const EMPTY_MEDIA: SuccessfulSearchItem[] = [];
const EMPTY_BOOKS: SuccessfulSearchItem[] = [];
const EMPTY_MUSIC: SuccessfulSearchItem[] = [];

const EMPTY_BY_CATEGORY: SuccessfulSearchStore = {
  media: EMPTY_MEDIA,
  books: EMPTY_BOOKS,
  music: EMPTY_MUSIC,
};

const EMPTY_STORE: SuccessfulSearchStore = {
  media: EMPTY_MEDIA,
  books: EMPTY_BOOKS,
  music: EMPTY_MUSIC,
};

let cachedRaw: string | null = null;
let cachedStore: SuccessfulSearchStore = EMPTY_STORE;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emptyList(category: SuccessfulSearchCategory): SuccessfulSearchItem[] {
  return EMPTY_BY_CATEGORY[category];
}

function isSearchCategory(value: string): value is SuccessfulSearchCategory {
  return value === "media" || value === "books" || value === "music";
}

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function sanitizeTrack(value: unknown): SuccessfulSearchTrack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = sanitizeString(record.id);
  const title = sanitizeString(record.title);
  const albumName = sanitizeString(record.albumName);
  const imageUrl = sanitizeString(record.imageUrl);
  const artists = sanitizeStringList(record.artists);
  const durationMs =
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? record.durationMs
      : 0;

  if (!id || !title || !albumName || !imageUrl || !artists) {
    return null;
  }

  return {
    id,
    title,
    artists,
    artistIds: sanitizeStringList(record.artistIds),
    albumName,
    albumId: sanitizeString(record.albumId),
    imageUrl,
    durationMs,
    youtubeVideoId: sanitizeString(record.youtubeVideoId),
  };
}

function sanitizeItem(value: unknown): SuccessfulSearchItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = sanitizeString(record.id);
  const title = sanitizeString(record.title);
  const kind =
    typeof record.kind === "string" && KINDS.includes(record.kind as SuccessfulSearchKind)
      ? (record.kind as SuccessfulSearchKind)
      : null;

  if (!id || !title || !kind) {
    return null;
  }

  const item: SuccessfulSearchItem = { id, kind, title };
  const subtitle = sanitizeString(record.subtitle);
  if (subtitle) {
    item.subtitle = subtitle;
  }
  const imageUrl = sanitizeString(record.imageUrl);
  if (imageUrl) {
    item.imageUrl = imageUrl;
  }

  if (kind === "track") {
    const track = sanitizeTrack(record.track);
    if (!track) {
      return null;
    }
    item.track = track;
    return item;
  }

  const href = sanitizeString(record.href);
  if (!href) {
    return null;
  }
  item.href = href;
  return item;
}

function sanitizeItems(value: unknown): SuccessfulSearchItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const items: SuccessfulSearchItem[] = [];
  for (const entry of value) {
    const item = sanitizeItem(entry);
    if (!item || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    items.push(item);
    if (items.length >= SUCCESSFUL_SEARCHES_LIMIT) {
      break;
    }
  }
  return items;
}

function parseStore(raw: string | null): SuccessfulSearchStore {
  if (!raw) {
    return EMPTY_STORE;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return EMPTY_STORE;
    }
    const record = parsed as Record<string, unknown>;
    const store: SuccessfulSearchStore = {
      media: sanitizeItems(record.media),
      books: sanitizeItems(record.books),
      music: sanitizeItems(record.music),
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

function readStore(): SuccessfulSearchStore {
  if (!canUseStorage()) {
    return EMPTY_STORE;
  }
  const raw = window.localStorage.getItem(SUCCESSFUL_SEARCHES_STORAGE_KEY);
  if (raw === cachedRaw) {
    return cachedStore;
  }
  cachedRaw = raw;
  cachedStore = parseStore(raw);
  return cachedStore;
}

function writeStore(store: SuccessfulSearchStore): SuccessfulSearchStore {
  if (!canUseStorage()) {
    return EMPTY_STORE;
  }
  const next: SuccessfulSearchStore = {
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
    window.localStorage.setItem(SUCCESSFUL_SEARCHES_STORAGE_KEY, serialized);
  } catch {
    // Quota / private mode — ignore.
  }
  cachedRaw = serialized;
  cachedStore = next;
  notifySuccessfulSearchesChanged();
  return next;
}

export function getSuccessfulSearchesSnapshot(
  category: SuccessfulSearchCategory,
): SuccessfulSearchItem[] {
  const list = readStore()[category];
  return list.length > 0 ? list : emptyList(category);
}

export function loadSuccessfulSearches(
  category: SuccessfulSearchCategory,
): SuccessfulSearchItem[] {
  return getSuccessfulSearchesSnapshot(category);
}

export function recordSuccessfulSearch(
  category: SuccessfulSearchCategory,
  item: SuccessfulSearchItem,
): SuccessfulSearchItem[] {
  if (!isSearchCategory(category)) {
    return emptyList("media");
  }
  const sanitized = sanitizeItem(item);
  if (!sanitized) {
    return getSuccessfulSearchesSnapshot(category);
  }

  const store = readStore();
  const current = store[category];
  const nextList = [
    sanitized,
    ...current.filter((entry) => entry.id !== sanitized.id),
  ].slice(0, SUCCESSFUL_SEARCHES_LIMIT);

  writeStore({
    ...store,
    [category]: nextList,
  });
  return nextList;
}

export function notifySuccessfulSearchesChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(SUCCESSFUL_SEARCHES_EVENT));
}

export function subscribeSuccessfulSearches(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(SUCCESSFUL_SEARCHES_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(SUCCESSFUL_SEARCHES_EVENT, handler);
  };
}

/** Test helper — clears in-memory snapshot cache. */
export function resetSuccessfulSearchesCacheForTests() {
  cachedRaw = null;
  cachedStore = EMPTY_STORE;
}
