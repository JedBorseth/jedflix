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

export const MAX_LIKED_SONGS = 500;
export const MAX_PLAYLISTS = 100;
export const MAX_PLAYLIST_TRACKS = 500;

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
