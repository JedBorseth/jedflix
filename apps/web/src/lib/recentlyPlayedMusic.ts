const STORAGE_KEY = "jedflix.music.recentlyPlayed";
const MAX_RECENT = 12;

export type RecentMusicTrack = {
  id: string;
  title: string;
  artists: string[];
  albumName: string;
  albumId?: string;
  imageUrl: string;
  durationMs: number;
  playedAt: number;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadRecentlyPlayedMusic(): RecentMusicTrack[] {
  if (!canUseStorage()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as RecentMusicTrack[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.title === "string")
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function recordRecentlyPlayedMusic(
  track: Omit<RecentMusicTrack, "playedAt">,
): RecentMusicTrack[] {
  if (!canUseStorage()) {
    return [];
  }
  const next: RecentMusicTrack = {
    ...track,
    artists: track.artists.filter(Boolean),
    playedAt: Date.now(),
  };
  const existing = loadRecentlyPlayedMusic().filter((item) => item.id !== next.id);
  const list = [next, ...existing].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Quota / private mode — ignore.
  }
  return list;
}

export const RECENTLY_PLAYED_LIMIT = MAX_RECENT;
