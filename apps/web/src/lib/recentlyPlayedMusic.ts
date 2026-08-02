const STORAGE_KEY = "jedflix.music.recentlyPlayed";
const MAX_RECENT = 12;
const RECENT_EVENT = "jedflix-music-recent";

export type RecentMusicTrack = {
  id: string;
  title: string;
  artists: string[];
  artistIds?: string[];
  albumName: string;
  albumId?: string;
  imageUrl: string;
  durationMs: number;
  playedAt: number;
};

const EMPTY_RECENT: RecentMusicTrack[] = [];

let cachedRaw: string | null = null;
let cachedTracks: RecentMusicTrack[] = EMPTY_RECENT;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function parseTracks(raw: string | null): RecentMusicTrack[] {
  if (!raw) {
    return EMPTY_RECENT;
  }
  try {
    const parsed = JSON.parse(raw) as RecentMusicTrack[];
    if (!Array.isArray(parsed)) {
      return EMPTY_RECENT;
    }
    const tracks = parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.title === "string")
      .slice(0, MAX_RECENT);
    return tracks.length > 0 ? tracks : EMPTY_RECENT;
  } catch {
    return EMPTY_RECENT;
  }
}

/**
 * Snapshot for useSyncExternalStore — must return a stable reference when
 * storage content is unchanged (new arrays every call cause React #185 loops).
 */
export function getRecentlyPlayedMusicSnapshot(): RecentMusicTrack[] {
  if (!canUseStorage()) {
    return EMPTY_RECENT;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) {
    return cachedTracks;
  }
  cachedRaw = raw;
  cachedTracks = parseTracks(raw);
  return cachedTracks;
}

/** @deprecated Prefer getRecentlyPlayedMusicSnapshot for React subscriptions. */
export function loadRecentlyPlayedMusic(): RecentMusicTrack[] {
  return getRecentlyPlayedMusicSnapshot();
}

export function recordRecentlyPlayedMusic(
  track: Omit<RecentMusicTrack, "playedAt">,
): RecentMusicTrack[] {
  if (!canUseStorage()) {
    return EMPTY_RECENT;
  }
  const next: RecentMusicTrack = {
    ...track,
    artists: track.artists.filter(Boolean),
    playedAt: Date.now(),
  };
  const existing = getRecentlyPlayedMusicSnapshot().filter((item) => item.id !== next.id);
  const list = [next, ...existing].slice(0, MAX_RECENT);
  const serialized = JSON.stringify(list);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Quota / private mode — ignore.
  }
  cachedRaw = serialized;
  cachedTracks = list;
  notifyRecentlyPlayedMusicChanged();
  return list;
}

export function notifyRecentlyPlayedMusicChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(RECENT_EVENT));
}

export function subscribeRecentlyPlayedMusic(onStoreChange: () => void) {
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
export function resetRecentlyPlayedMusicCacheForTests() {
  cachedRaw = null;
  cachedTracks = EMPTY_RECENT;
}

export const RECENTLY_PLAYED_LIMIT = MAX_RECENT;
export const RECENTLY_PLAYED_EVENT = RECENT_EVENT;
