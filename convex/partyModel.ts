import { v } from "convex/values";

/** Mirrors MusicQueueTrack on the web client. `id` is a Spotify track id. */
export const partyTrackValidator = v.object({
  id: v.string(),
  title: v.string(),
  artists: v.array(v.string()),
  artistIds: v.optional(v.array(v.string())),
  albumName: v.string(),
  albumId: v.optional(v.string()),
  imageUrl: v.string(),
  durationMs: v.number(),
});

export type PartyTrack = {
  id: string;
  title: string;
  artists: string[];
  artistIds?: string[];
  albumName: string;
  albumId?: string;
  imageUrl: string;
  durationMs: number;
};

/** Excludes I/O/0/1 so codes stay readable when spoken aloud. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PARTY_CODE_LENGTH = 6;

/** Queue is stored as one array; capped so the document stays well under 1MB. */
export const MAX_PARTY_QUEUE = 100;

/** Number of upcoming tracks handed to Spotify so it has playback context. */
export const SPOTIFY_CONTEXT_TRACKS = 20;

/** Ignore polled Spotify state this long after a push — the device lags behind. */
export const SPOTIFY_PUSH_GRACE_MS = 6_000;

export const PARTY_POLL_INTERVAL_MS = 2_500;

/** A member that has not sent a heartbeat within this window is treated as gone. */
export const MEMBER_ONLINE_WINDOW_MS = 45_000;

/** Members stale for this long are pruned, which also lets the poller wind down. */
export const MEMBER_STALE_WINDOW_MS = 5 * 60_000;

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

export function generatePartyCode(): string {
  let code = "";
  for (let i = 0; i < PARTY_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizePartyCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidPartyCode(raw: string): boolean {
  const code = normalizePartyCode(raw);
  if (code.length !== PARTY_CODE_LENGTH) {
    return false;
  }
  return [...code].every((char) => CODE_ALPHABET.includes(char));
}

export function isSpotifyTrackId(id: string): boolean {
  return SPOTIFY_ID_PATTERN.test(id);
}

export function toSpotifyTrackUri(id: string): string | null {
  return isSpotifyTrackId(id) ? `spotify:track:${id}` : null;
}

export function trimQueue(tracks: PartyTrack[]): PartyTrack[] {
  return tracks.slice(0, MAX_PARTY_QUEUE);
}

type SpotifyApiTrack = {
  id?: unknown;
  name?: unknown;
  duration_ms?: unknown;
  artists?: unknown;
  album?: unknown;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Converts a track object from the Spotify Web API into our party track shape. */
export function spotifyTrackToPartyTrack(raw: unknown): PartyTrack | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const track = raw as SpotifyApiTrack;
  const id = stringOrNull(track.id);
  const title = stringOrNull(track.name);
  if (!id || !title) {
    return null;
  }

  const artistEntries = Array.isArray(track.artists) ? track.artists : [];
  const artists: string[] = [];
  const artistIds: string[] = [];
  for (const entry of artistEntries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const name = stringOrNull((entry as { name?: unknown }).name);
    if (!name) {
      continue;
    }
    artists.push(name);
    artistIds.push(stringOrNull((entry as { id?: unknown }).id) ?? "");
  }

  const album =
    typeof track.album === "object" && track.album !== null
      ? (track.album as { id?: unknown; name?: unknown; images?: unknown })
      : null;
  const images = album && Array.isArray(album.images) ? album.images : [];
  const imageUrl = images.reduce<string>((best, image) => {
    if (best) {
      return best;
    }
    if (typeof image !== "object" || image === null) {
      return best;
    }
    return stringOrNull((image as { url?: unknown }).url) ?? best;
  }, "");

  return {
    id,
    title,
    artists: artists.length > 0 ? artists : ["Unknown artist"],
    artistIds: artistIds.some((value) => value.length > 0) ? artistIds : undefined,
    albumName: (album && stringOrNull(album.name)) ?? "",
    albumId: (album && stringOrNull(album.id)) ?? undefined,
    imageUrl,
    durationMs: typeof track.duration_ms === "number" ? track.duration_ms : 0,
  };
}
