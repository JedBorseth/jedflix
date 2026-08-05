import { v } from "convex/values";

/** Mirrors MusicQueueTrack on the web client. `id` is a Spotify track id. */
export const musicTrackValidator = v.object({
  id: v.string(),
  title: v.string(),
  artists: v.array(v.string()),
  artistIds: v.optional(v.array(v.string())),
  albumName: v.string(),
  albumId: v.optional(v.string()),
  imageUrl: v.string(),
  durationMs: v.number(),
});

export type MusicTrack = {
  id: string;
  title: string;
  artists: string[];
  artistIds?: string[];
  albumName: string;
  albumId?: string;
  imageUrl: string;
  durationMs: number;
};

/**
 * Caps sized for Spotify library imports (10k+ tracks). Each track is its own
 * Convex document, so storage scales; mutations always write in small batches.
 */
export const MAX_LIKED_SONGS = 20_000;
export const MAX_PLAYLISTS = 200;
export const MAX_PLAYLIST_TRACKS = 20_000;

/** Spotify playlist/liked pages are 50; keep DB writes aligned. */
export const IMPORT_TRACK_BATCH_SIZE = 50;

/** Max docs deleted/updated per scheduled continuation. */
export const LIBRARY_MUTATION_BATCH_SIZE = 100;

export function normalizeTrack(track: MusicTrack): MusicTrack {
  const id = track.id.trim();
  if (!id) {
    throw new Error("Track id is required");
  }
  return {
    id,
    title: track.title.trim() || "Unknown track",
    artists: track.artists.map((name) => name.trim()).filter(Boolean),
    artistIds: track.artistIds?.map((artistId) => artistId.trim()).filter(Boolean),
    albumName: track.albumName.trim() || "Unknown album",
    albumId: track.albumId?.trim() || undefined,
    imageUrl: track.imageUrl.trim(),
    durationMs: Math.max(0, Math.floor(track.durationMs)),
  };
}
