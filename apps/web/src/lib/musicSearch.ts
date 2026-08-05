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
