import {
  createStreamClient,
  type SpotifyAlbum,
  type SpotifyArtist,
  type SpotifyArtistDetails,
  type SpotifyBrowseResponse,
  type SpotifyCatalogRow,
  type SpotifySearchResponse,
  type SpotifyTopTrack,
  type SpotifyTrack,
} from "@jedflix/stream-client";

export type AlbumItem = SpotifyAlbum;
export type AlbumDetails = SpotifyAlbum;
export type ArtistSummary = SpotifyArtist;
export type ArtistDetails = SpotifyArtistDetails;
export type MusicBrowseResponse = SpotifyBrowseResponse;
export type MusicCatalogRow = SpotifyCatalogRow;
export type MusicSearchResults = SpotifySearchResponse;
export type TrackItem = SpotifyTrack;
export type TopTrackItem = SpotifyTopTrack;

const streamClient = createStreamClient({
  apiBase: import.meta.env.VITE_STREAM_API_URL ?? "/stream-api",
  apiKey: import.meta.env.VITE_STREAM_API_KEY,
});

const SPOTIFY_ID_PATTERN = /^[a-zA-Z0-9]{22}$/;

export function getAlbumDetailPath(album: Pick<AlbumItem, "id">) {
  return `/album/${album.id}`;
}

export function getArtistPath(artistId: string) {
  return `/music-artist/${artistId}`;
}

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
  return SPOTIFY_ID_PATTERN.test(candidate) ? candidate : null;
}

export async function getMusicBrowse(): Promise<MusicBrowseResponse> {
  return streamClient.fetchSpotifyBrowse();
}

export async function searchMusicAll(query: string): Promise<MusicSearchResults> {
  return streamClient.searchSpotify(query);
}

export async function getAlbumDetails(albumId: string): Promise<AlbumDetails> {
  return streamClient.fetchSpotifyAlbum(albumId);
}

export async function getArtistDetails(artistId: string): Promise<ArtistDetails> {
  return streamClient.fetchSpotifyArtist(artistId);
}

export function getYoutubeAudioUrl(params: {
  artist?: string;
  title?: string;
  album?: string;
  durationMs?: number;
  videoId?: string;
}): string {
  return streamClient.getYoutubeAudioUrl(params);
}

export async function resolveYoutubeAudio(params: {
  artist?: string;
  title?: string;
  album?: string;
  durationMs?: number;
  videoId?: string;
  signal?: AbortSignal;
}) {
  return streamClient.resolveYoutubeAudio(params);
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
