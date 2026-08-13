import {
  createStreamClient,
  type LastFmRelatedResponse,
  type LastFmSimilarArtistsResponse,
  type LastFmSimilarTracksResponse,
  type SpotifyArtist,
  type SpotifyTopTrack,
} from "@jedflix/stream-client";
import { getBackendApiBase } from "@/lib/backendEnv";

const streamClient = createStreamClient({
  apiBase: getBackendApiBase(),
});

export type RelatedMusic = LastFmRelatedResponse;

export async function getSimilarArtists(
  artist: string,
  limit = 6,
): Promise<SpotifyArtist[]> {
  const name = artist.trim();
  if (!name) {
    return [];
  }
  try {
    const result: LastFmSimilarArtistsResponse =
      await streamClient.fetchLastFmSimilarArtists(name, limit);
    return result.artists ?? [];
  } catch {
    // Last.fm is optional — pages should keep working without it.
    return [];
  }
}

export async function getSimilarTracks(
  artist: string,
  track: string,
  limit = 8,
): Promise<SpotifyTopTrack[]> {
  const artistName = artist.trim();
  const trackName = track.trim();
  if (!artistName || !trackName) {
    return [];
  }
  try {
    const result: LastFmSimilarTracksResponse =
      await streamClient.fetchLastFmSimilarTracks(artistName, trackName, limit);
    return result.tracks ?? [];
  } catch {
    return [];
  }
}

export async function getRelatedMusic(params: {
  artist?: string;
  track?: string;
  seeds?: Array<{ artist: string; track: string; id?: string }>;
  limit?: number;
}): Promise<RelatedMusic> {
  try {
    return await streamClient.fetchLastFmRelated(params);
  } catch {
    return { artists: [], tracks: [] };
  }
}

export function topTrackToQueueFields(track: SpotifyTopTrack) {
  return {
    id: track.id,
    title: track.name,
    artists: track.artists,
    artistIds: track.artistIds,
    albumName: track.albumName || "Unknown album",
    albumId: track.albumId || undefined,
    imageUrl: track.imageUrl,
    durationMs: track.durationMs,
  };
}
