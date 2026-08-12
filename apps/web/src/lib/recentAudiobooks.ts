import type { StreamSource } from "@/lib/streamApi";

const STORAGE_KEY = "jedflix.audiobooks.recent";
const MAX_RECENT = 24;
const RECENT_EVENT = "jedflix-audiobook-recent";

export type SavedAudiobookStream = {
  id: string;
  title: string;
  magnet?: string;
  infoHash?: string;
  abbPostUrl?: string;
  sizeGb?: number;
  seeders?: number;
  cached?: boolean;
  info?: string;
  matchScore?: number;
};

export type RecentAudiobook = {
  id: string;
  title: string;
  coverUrl: string;
  coverFullUrl?: string;
  authors: string[];
  openedAt: number;
  progressSeconds?: number;
  fileIndex?: number;
  selectedStream?: SavedAudiobookStream;
};

const EMPTY_RECENT: RecentAudiobook[] = [];

let cachedRaw: string | null = null;
let cachedBooks: RecentAudiobook[] = EMPTY_RECENT;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isSavedStream(value: unknown): value is SavedAudiobookStream {
  if (!value || typeof value !== "object") {
    return false;
  }
  const stream = value as SavedAudiobookStream;
  return typeof stream.id === "string" && typeof stream.title === "string";
}

function parseBooks(raw: string | null): RecentAudiobook[] {
  if (!raw) {
    return EMPTY_RECENT;
  }
  try {
    const parsed = JSON.parse(raw) as RecentAudiobook[];
    if (!Array.isArray(parsed)) {
      return EMPTY_RECENT;
    }
    const books = parsed
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.coverUrl === "string",
      )
      .map((item) => ({
        id: item.id,
        title: item.title,
        coverUrl: item.coverUrl,
        coverFullUrl: typeof item.coverFullUrl === "string" ? item.coverFullUrl : undefined,
        authors: Array.isArray(item.authors)
          ? item.authors.filter((author): author is string => typeof author === "string")
          : [],
        openedAt: typeof item.openedAt === "number" ? item.openedAt : 0,
        progressSeconds:
          typeof item.progressSeconds === "number" ? item.progressSeconds : undefined,
        fileIndex: typeof item.fileIndex === "number" ? item.fileIndex : undefined,
        selectedStream: isSavedStream(item.selectedStream) ? item.selectedStream : undefined,
      }))
      .slice(0, MAX_RECENT);
    return books.length > 0 ? books : EMPTY_RECENT;
  } catch {
    return EMPTY_RECENT;
  }
}

function writeBooks(list: RecentAudiobook[]): RecentAudiobook[] {
  if (!canUseStorage()) {
    return EMPTY_RECENT;
  }
  const serialized = JSON.stringify(list);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Quota / private mode — ignore.
  }
  cachedRaw = serialized;
  cachedBooks = list;
  notifyRecentAudiobooksChanged();
  return list;
}

/**
 * Snapshot for useSyncExternalStore — must return a stable reference when
 * storage content is unchanged.
 */
export function getRecentAudiobooksSnapshot(): RecentAudiobook[] {
  if (!canUseStorage()) {
    return EMPTY_RECENT;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) {
    return cachedBooks;
  }
  cachedRaw = raw;
  cachedBooks = parseBooks(raw);
  return cachedBooks;
}

export function loadRecentAudiobooks(): RecentAudiobook[] {
  return getRecentAudiobooksSnapshot();
}

export function getRecentAudiobook(workId: string): RecentAudiobook | null {
  return getRecentAudiobooksSnapshot().find((book) => book.id === workId) ?? null;
}

export function toSavedAudiobookStream(source: StreamSource): SavedAudiobookStream {
  return {
    id: source.id,
    title: source.title,
    magnet: source.magnet || undefined,
    infoHash: source.infoHash,
    abbPostUrl: source.abbPostUrl,
    sizeGb: source.sizeGb,
    seeders: source.seeders,
    cached: source.cached,
    info: source.info,
    matchScore: source.matchScore,
  };
}

export function toStreamSource(saved: SavedAudiobookStream): StreamSource {
  return {
    id: saved.id,
    title: saved.title,
    magnet: saved.magnet ?? "",
    infoHash: saved.infoHash,
    abbPostUrl: saved.abbPostUrl,
    sizeGb: saved.sizeGb,
    seeders: saved.seeders,
    cached: saved.cached,
    info: saved.info,
    matchScore: saved.matchScore,
  };
}

export function recordRecentAudiobook(
  book: Omit<RecentAudiobook, "openedAt"> & { openedAt?: number },
): RecentAudiobook[] {
  if (!canUseStorage()) {
    return EMPTY_RECENT;
  }
  const existing = getRecentAudiobooksSnapshot().find((item) => item.id === book.id);
  const next: RecentAudiobook = {
    id: book.id,
    title: book.title,
    coverUrl: book.coverUrl,
    coverFullUrl: book.coverFullUrl ?? existing?.coverFullUrl,
    authors: book.authors.filter(Boolean),
    openedAt: book.openedAt ?? Date.now(),
    progressSeconds: book.progressSeconds ?? existing?.progressSeconds,
    fileIndex: book.fileIndex ?? existing?.fileIndex,
    selectedStream: book.selectedStream ?? existing?.selectedStream,
  };
  const rest = getRecentAudiobooksSnapshot().filter((item) => item.id !== next.id);
  return writeBooks([next, ...rest].slice(0, MAX_RECENT));
}

export function saveRecentAudiobookStream(
  workId: string,
  source: StreamSource,
): RecentAudiobook[] {
  const existing = getRecentAudiobook(workId);
  if (!existing) {
    return getRecentAudiobooksSnapshot();
  }
  return recordRecentAudiobook({
    ...existing,
    selectedStream: toSavedAudiobookStream(source),
    openedAt: Date.now(),
  });
}

export function saveRecentAudiobookProgress(
  workId: string,
  progress: { fileIndex: number; positionSec: number },
): RecentAudiobook[] {
  const existing = getRecentAudiobook(workId);
  if (!existing) {
    return getRecentAudiobooksSnapshot();
  }
  return recordRecentAudiobook({
    ...existing,
    progressSeconds: progress.positionSec,
    fileIndex: progress.fileIndex,
    openedAt: Date.now(),
  });
}

export function hasContinueProgress(entry: {
  progressSeconds?: number;
  fileIndex?: number;
} | null | undefined): boolean {
  if (!entry) {
    return false;
  }
  const progress = entry.progressSeconds ?? 0;
  const fileIndex = entry.fileIndex ?? 0;
  return progress >= 15 || fileIndex > 0;
}

export function notifyRecentAudiobooksChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(RECENT_EVENT));
}

export function subscribeRecentAudiobooks(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(RECENT_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(RECENT_EVENT, handler);
  };
}

/** Test helper — clears in-memory snapshot cache. */
export function resetRecentAudiobooksCacheForTests() {
  cachedRaw = null;
  cachedBooks = EMPTY_RECENT;
}

export const RECENT_AUDIOBOOKS_LIMIT = MAX_RECENT;
export const RECENT_AUDIOBOOKS_EVENT = RECENT_EVENT;
