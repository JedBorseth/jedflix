import {
  createStreamClient,
  type SpotifyAlbum,
  type SpotifyArtist,
  type SpotifyArtistDetails,
  type SpotifyBrowseResponse,
  type SpotifyCatalogRow,
  type SpotifyTopTrack,
  type SpotifyTrack,
} from "@jedflix/stream-client";
import {
  mergeMusicSearchTracks,
  spotifyTopTrackToSearchTrack,
  youtubeHitToSearchTrack,
  type MusicSearchResults,
  type MusicSearchTrack,
} from "@/lib/musicSearch";
import { getBackendApiBase } from "@/lib/backendEnv";

export type AlbumItem = SpotifyAlbum;
export type AlbumDetails = SpotifyAlbum;
export type ArtistSummary = SpotifyArtist;
export type ArtistDetails = SpotifyArtistDetails;
export type MusicBrowseResponse = SpotifyBrowseResponse;
export type MusicCatalogRow = SpotifyCatalogRow;
export type { MusicSearchResults, MusicSearchTrack };
export type TrackItem = SpotifyTrack;
export type TopTrackItem = SpotifyTopTrack;


const streamClient = createStreamClient({
  apiBase: getBackendApiBase(),
});

// Accept MusicBrainz MBIDs (UUID) and legacy Spotify 22-char ids.
const CATALOG_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-zA-Z0-9]{22})$/i;

export function getAlbumDetailPath(album: Pick<AlbumItem, "id">) {
  return `/album/${album.id}`;
}

export function getArtistPath(artistId: string) {
  return `/music-artist/${artistId}`;
}

/** Normalize a catalog id (MusicBrainz MBID or legacy Spotify id). */
export function normalizeSpotifyId(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  let candidate = value.trim();
  if (candidate.includes(":")) {
    const parts = candidate.split(":");
    candidate = parts[parts.length - 1] ?? candidate;
  }
  if (candidate.includes("/")) {
    const parts = candidate.split("/");
    candidate = parts[parts.length - 1] ?? candidate;
  }
  candidate = candidate.split("?")[0] ?? candidate;
  return CATALOG_ID_PATTERN.test(candidate) ? candidate : null;
}

export async function getMusicBrowse(): Promise<MusicBrowseResponse> {
  return streamClient.fetchSpotifyBrowse();
}

export async function searchMusicAll(
  query: string,
  options: { includeYoutube?: boolean } = {},
): Promise<MusicSearchResults> {
  const spotifyPromise = streamClient.searchSpotify(query);
  const youtubePromise = options.includeYoutube
    ? streamClient.searchYoutubeMusic(query).catch(() => ({ tracks: [] }))
    : Promise.resolve({ tracks: [] });

  const [spotify, youtube] = await Promise.all([spotifyPromise, youtubePromise]);
  const spotifyTracks = (spotify.tracks ?? []).map(spotifyTopTrackToSearchTrack);
  const youtubeTracks = (youtube.tracks ?? []).map(youtubeHitToSearchTrack);

  return {
    albums: spotify.albums ?? [],
    artists: spotify.artists ?? [],
    tracks: mergeMusicSearchTracks(spotifyTracks, youtubeTracks),
  };
}

export async function getAlbumDetails(
  albumId: string,
  hints?: { name?: string; artists?: string[] },
): Promise<AlbumDetails> {
  return streamClient.fetchSpotifyAlbum(albumId, {
    name: hints?.name,
    artist: hints?.artists?.[0],
  });
}

export async function getArtistDetails(
  artistId: string,
  hints?: { name?: string },
): Promise<ArtistDetails> {
  return streamClient.fetchSpotifyArtist(artistId, hints);
}

/** One Spotify albums page — for album detail "More from this artist". */
export async function getArtistAlbums(
  artistId: string,
  options?: { name?: string; limit?: number },
): Promise<AlbumItem[]> {
  return streamClient.fetchSpotifyArtistAlbums(artistId, options);
}

export function getYoutubeAudioUrl(params: {
  artist: string;
  title: string;
  album?: string;
  durationMs?: number;
  videoId?: string;
}): string {
  return streamClient.getYoutubeAudioUrl(params);
}

export function formatTrackDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0:00";
  }
  const totalSec = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function pickRandomAlbum(albums: AlbumItem[]): AlbumItem | undefined {
  if (albums.length === 0) {
    return undefined;
  }
  const withCover = albums.filter((album) => !album.imageUrl.includes("placehold.co"));
  const pool = withCover.length > 0 ? withCover : albums;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}
