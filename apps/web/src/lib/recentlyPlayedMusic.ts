import { canUseStorage, createLocalStorageSnapshot } from "@/lib/localStorageSnapshot";

const STORAGE_KEY = "jedflix.music.recentlyPlayed";
/** 4 rows × 2 columns on the music home grid. */
const MAX_RECENT = 8;
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

const storage = createLocalStorageSnapshot(
  STORAGE_KEY,
  RECENT_EVENT,
  EMPTY_RECENT,
  parseTracks,
);

export const getRecentlyPlayedMusicSnapshot = storage.getSnapshot;

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
  return storage.write([next, ...existing].slice(0, MAX_RECENT));
}

export const notifyRecentlyPlayedMusicChanged = storage.notify;
export const subscribeRecentlyPlayedMusic = storage.subscribe;
export const resetRecentlyPlayedMusicCacheForTests = storage.reset;
