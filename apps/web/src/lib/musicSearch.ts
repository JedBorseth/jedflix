import type { SpotifyAlbum, SpotifyArtist, SpotifyTopTrack } from "@jedflix/stream-client";

export type MusicSearchTrack = SpotifyTopTrack & {
  source?: "spotify" | "youtube";
  youtubeVideoId?: string;
};

export type MusicSearchResults = {
  albums: SpotifyAlbum[];
  artists: SpotifyArtist[];
  tracks: MusicSearchTrack[];
};

export type RankedMusicHit =
  | { kind: "track"; id: string; score: number; track: MusicSearchTrack }
  | { kind: "album"; id: string; score: number; album: SpotifyAlbum }
  | { kind: "artist"; id: string; score: number; artist: SpotifyArtist };

export function normalizeMusicDedupeKey(artists: string[], name: string): string {
  const artist = normalizeToken(artists.join(" "));
  const title = normalizeToken(name)
    .replace(/\b(official audio|official video|official music video|lyrics?|audio only|visualizer|mv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${artist}|${title}`;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Spotify search has no relevance score in the API response. We score locally so
 * exact / prefix matches (e.g. Thriller) beat popular-but-loose popularity sorts.
 */
export function scoreMusicNameMatch(query: string, name: string, popularity = 0): number {
  const q = normalizeToken(query);
  const n = normalizeToken(name);
  const pop = clampPopularity(popularity);
  if (!q || !n) {
    return pop;
  }
  if (n === q) {
    return 10_000 + pop;
  }
  if (n.startsWith(`${q} `) || n.startsWith(q)) {
    return 8_000 + pop;
  }
  if (n.includes(` ${q} `) || n.endsWith(` ${q}`)) {
    return 6_500 + pop;
  }
  if (n.includes(q)) {
    return 5_500 + pop;
  }

  const queryTokens = q.split(" ").filter((token) => token.length > 1);
  if (queryTokens.length > 1) {
    const nameTokens = new Set(n.split(" ").filter(Boolean));
    const hits = queryTokens.filter((token) => nameTokens.has(token) || n.includes(token)).length;
    if (hits === queryTokens.length) {
      return 4_000 + pop + hits * 10;
    }
    if (hits > 0) {
      return 1_500 + pop + hits * 20;
    }
  }

  return pop;
}

function clampPopularity(popularity: number): number {
  if (!Number.isFinite(popularity) || popularity <= 0) {
    return 0;
  }
  return Math.min(100, Math.round(popularity));
}

/** Prefer Spotify hits when the same song appears on YouTube. */
export function mergeMusicSearchTracks(
  spotifyTracks: MusicSearchTrack[],
  youtubeTracks: MusicSearchTrack[],
): MusicSearchTrack[] {
  const merged: MusicSearchTrack[] = [];
  const seen = new Set<string>();

  for (const track of spotifyTracks) {
    const key = normalizeMusicDedupeKey(track.artists, track.name);
    if (!key || key === "|") {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ ...track, source: track.source ?? "spotify" });
  }

  for (const track of youtubeTracks) {
    const key = normalizeMusicDedupeKey(track.artists, track.name);
    if (!key || key === "|") {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({ ...track, source: "youtube" });
  }

  return merged;
}

/** Combine songs, albums, and artists into one list sorted by query relevance. */
export function rankMusicSearchResults(
  query: string,
  results: MusicSearchResults,
): RankedMusicHit[] {
  const hits: RankedMusicHit[] = [];

  for (const track of results.tracks) {
    hits.push({
      kind: "track",
      id: `track:${track.id}`,
      track,
      score: scoreMusicNameMatch(query, track.name, 0),
    });
  }
  for (const album of results.albums) {
    hits.push({
      kind: "album",
      id: `album:${album.id}`,
      album,
      score: scoreMusicNameMatch(query, album.name, album.popularity ?? 0),
    });
  }
  for (const artist of results.artists) {
    hits.push({
      kind: "artist",
      id: `artist:${artist.id}`,
      artist,
      score: scoreMusicNameMatch(query, artist.name, artist.popularity ?? 0),
    });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Stable-ish tie-break: albums, then artists, then tracks.
    const order = { album: 0, artist: 1, track: 2 } as const;
    return order[a.kind] - order[b.kind];
  });

  return hits;
}

export function spotifyTopTrackToSearchTrack(track: SpotifyTopTrack): MusicSearchTrack {
  return {
    ...track,
    source: "spotify",
  };
}

export function youtubeHitToSearchTrack(track: {
  id: string;
  videoId: string;
  name: string;
  artists: string[];
  albumName: string;
  imageUrl: string;
  durationMs: number;
}): MusicSearchTrack {
  return {
    id: track.id,
    name: track.name,
    artists: track.artists,
    artistIds: [],
    trackNumber: 0,
    discNumber: 1,
    durationMs: track.durationMs,
    explicit: false,
    albumId: "",
    albumName: track.albumName || "YouTube",
    imageUrl: track.imageUrl,
    source: "youtube",
    youtubeVideoId: track.videoId,
  };
}

/** Fisher–Yates shuffle (copy). Used for music-home artist shelves only. */
export function shuffleItems<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const left = next[i];
    const right = next[j];
    if (left === undefined || right === undefined) {
      continue;
    }
    next[i] = right;
    next[j] = left;
  }
  return next;
}
