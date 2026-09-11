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

export function extractAudiobookInfoHash(
  magnet?: string | null,
  infoHash?: string | null,
): string | undefined {
  const fromHash = infoHash?.trim().toLowerCase();
  if (fromHash && (fromHash.length === 32 || fromHash.length === 40)) {
    return fromHash;
  }
  const trimmed = magnet?.trim();
  if (!trimmed) {
    return undefined;
  }
  const lower = trimmed.toLowerCase();
  const prefix = "urn:btih:";
  const idx = lower.indexOf(prefix);
  if (idx < 0) {
    return undefined;
  }
  const rest = trimmed.slice(idx + prefix.length);
  let end = 0;
  while (end < rest.length) {
    const char = rest[end];
    if (!char || !/[0-9a-fA-F]/.test(char)) {
      break;
    }
    end += 1;
  }
  const hash = rest.slice(0, end).toLowerCase();
  return hash.length === 32 || hash.length === 40 ? hash : undefined;
}

/** Store a hash-only magnet so replay can skip AudiobookBay and go straight to Real Debrid. */
export function compactAudiobookMagnet(
  magnet?: string | null,
  infoHash?: string | null,
): { magnet?: string; infoHash?: string } {
  const hash = extractAudiobookInfoHash(magnet, infoHash);
  if (hash) {
    return { magnet: `magnet:?xt=urn:btih:${hash}`, infoHash: hash };
  }
  const trimmed = magnet?.trim();
  return trimmed ? { magnet: trimmed } : {};
}

export function toSavedAudiobookStream(source: StreamSource): SavedAudiobookStream {
  const compact = compactAudiobookMagnet(source.magnet, source.infoHash);
  return {
    id: source.id,
    title: source.title,
    magnet: compact.magnet,
    infoHash: compact.infoHash,
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

export function hasSavedAudiobookStream(
  stream?: {
    magnet?: string | null;
    abbPostUrl?: string | null;
    infoHash?: string | null;
  } | null,
): boolean {
  if (!stream) {
    return false;
  }
  return Boolean(
    stream.magnet?.trim() || stream.abbPostUrl?.trim() || stream.infoHash?.trim(),
  );
}

/** Magnet or info hash is enough for Real Debrid — no AudiobookBay fetch. */
export function hasPlayableAudiobookMagnet(
  stream?: {
    magnet?: string | null;
    infoHash?: string | null;
  } | null,
): boolean {
  return Boolean(stream?.magnet?.trim() || stream?.infoHash?.trim());
}

export function playbackSourceFromSaved(
  local?: SavedAudiobookStream | null,
  convex?: {
    selectedStreamId?: string | null;
    selectedStreamTitle?: string | null;
    selectedStreamMagnet?: string | null;
    selectedStreamAbbPostUrl?: string | null;
    selectedStreamInfoHash?: string | null;
  } | null,
): StreamSource | undefined {
  const id = local?.id ?? convex?.selectedStreamId ?? undefined;
  const title = local?.title ?? convex?.selectedStreamTitle ?? undefined;
  if (!id || !title) {
    return undefined;
  }
  const compact = compactAudiobookMagnet(
    local?.magnet || convex?.selectedStreamMagnet,
    local?.infoHash || convex?.selectedStreamInfoHash,
  );
  const abbPostUrl = local?.abbPostUrl?.trim() || convex?.selectedStreamAbbPostUrl || undefined;
  if (!compact.magnet && !compact.infoHash && !abbPostUrl) {
    return undefined;
  }
  return {
    id,
    title,
    magnet: compact.magnet ?? "",
    infoHash: compact.infoHash,
    abbPostUrl,
    sizeGb: local?.sizeGb,
    seeders: local?.seeders,
    cached: local?.cached,
    info: local?.info,
    matchScore: local?.matchScore,
  };
}

export function overlaySavedMagnet(
  source: StreamSource,
  saved?: SavedAudiobookStreamRef | null,
): StreamSource {
  const compact = compactAudiobookMagnet(
    saved?.magnet || source.magnet,
    saved?.infoHash || source.infoHash,
  );
  if (!compact.magnet && !compact.infoHash) {
    return source;
  }
  return {
    ...source,
    magnet: compact.magnet ?? source.magnet,
    infoHash: compact.infoHash ?? source.infoHash,
  };
}

export function hasKnownGoodAudiobookStream(
  entry?: {
    selectedStream?: SavedAudiobookStream;
    selectedStreamMagnet?: string | null;
    selectedStreamAbbPostUrl?: string | null;
    selectedStreamInfoHash?: string | null;
  } | null,
): boolean {
  if (!entry) {
    return false;
  }
  return (
    hasSavedAudiobookStream(entry.selectedStream) ||
    Boolean(
      entry.selectedStreamMagnet?.trim() ||
        entry.selectedStreamAbbPostUrl?.trim() ||
        entry.selectedStreamInfoHash?.trim(),
    )
  );
}

export type SavedAudiobookStreamRef = {
  id?: string;
  title?: string;
  magnet?: string;
  abbPostUrl?: string;
  infoHash?: string;
};

export function findSavedAudiobookSource(
  sources: StreamSource[],
  saved?: SavedAudiobookStreamRef | null,
): StreamSource | undefined {
  if (!saved) {
    return undefined;
  }
  const preferredId = saved.id?.trim();
  const preferredAbb = saved.abbPostUrl?.trim();
  const preferredHash = saved.infoHash?.trim().toLowerCase();
  const found =
    sources.find((source) => preferredAbb && source.abbPostUrl === preferredAbb) ??
    sources.find(
      (source) =>
        preferredHash &&
        source.infoHash &&
        source.infoHash.toLowerCase() === preferredHash,
    ) ??
    sources.find((source) => preferredId && source.id === preferredId);
  return found ? overlaySavedMagnet(found, saved) : undefined;
}

export function prependLastUsedAudiobookSource(
  sources: StreamSource[],
  lastUsed?: StreamSource | null,
): StreamSource[] {
  if (!lastUsed) {
    return sources;
  }
  const rest = sources.filter((source) => {
    if (source.id === lastUsed.id) {
      return false;
    }
    if (lastUsed.abbPostUrl && source.abbPostUrl === lastUsed.abbPostUrl) {
      return false;
    }
    return true;
  });
  return [lastUsed, ...rest];
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
