/**
 * Thin Spotify Web API wrapper used by party mode.
 *
 * Plain async helpers only — no Convex function registrations. Callers pass an
 * access token that has already been refreshed.
 */

import { readEnv, requireEnv } from "./env";

const AUTH_BASE = "https://accounts.spotify.com";
const API_BASE = "https://api.spotify.com/v1";

/**
 * Observation scopes for following Spotify, plus modify so JedFlix can pause
 * and resume the active Spotify player. Track selection and seeking stay
 * Spotify-owned — we never start a different song or seek.
 * `user-read-private` labels the linked account in the UI.
 * Library scopes power playlist / liked-songs import into JedFlix.
 */
export const SPOTIFY_IMPORT_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
] as const;

export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
  ...SPOTIFY_IMPORT_SCOPES,
].join(" ");

export function hasImportScopes(scope: string | undefined | null): boolean {
  if (!scope) {
    return false;
  }
  const granted = new Set(scope.split(/\s+/).filter(Boolean));
  return SPOTIFY_IMPORT_SCOPES.every((needed) => granted.has(needed));
}
export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
};

export type SpotifyPlaybackState = {
  isPlaying: boolean;
  progressMs: number;
  deviceId: string | null;
  item: unknown;
};

export class SpotifyApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
  }
}

function credentials(): { clientId: string; clientSecret: string } {
  const notConfigured =
    "Spotify is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in the Convex deployment.";
  return {
    clientId: requireEnv("SPOTIFY_CLIENT_ID", notConfigured),
    clientSecret: requireEnv("SPOTIFY_CLIENT_SECRET", notConfigured),
  };
}

export function isSpotifyConfigured(): boolean {
  return Boolean(readEnv("SPOTIFY_CLIENT_ID") && readEnv("SPOTIFY_CLIENT_SECRET"));
}

/** Fixed redirect target registered in the Spotify developer dashboard. */
export function spotifyRedirectUri(): string {
  return `${requireEnv("CONVEX_SITE_URL")}/spotify/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: spotifyRedirectUri(),
    scope: SPOTIFY_SCOPES,
    state,
    // Always show the account chooser so a user can pick which Spotify account to control.
    show_dialog: "true",
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

async function requestTokens(form: URLSearchParams): Promise<SpotifyTokens> {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(`${AUTH_BASE}/api/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: form.toString(),
  });

  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
    error?: string;
  } | null;

  if (!response.ok || !body?.access_token) {
    const detail = body?.error_description ?? body?.error ?? `HTTP ${response.status}`;
    throw new SpotifyApiError(response.status, `Spotify token request failed: ${detail}`);
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    // Refresh a minute early so in-flight calls never race the expiry.
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000,
    scope: body.scope ?? SPOTIFY_SCOPES,
  };
}

export async function exchangeAuthorizationCode(code: string): Promise<SpotifyTokens> {
  return await requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyRedirectUri(),
    }),
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  return await requestTokens(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

async function apiFetch(
  accessToken: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (response.status === 429) {
    throw new SpotifyApiError(429, "Spotify rate limit reached");
  }
  return response;
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string; reason?: string };
  } | null;
  return body?.error?.message ?? body?.error?.reason ?? `HTTP ${response.status}`;
}

export type SpotifyProfile = {
  id: string;
  displayName: string;
  product: string | null;
  imageUrl: string | null;
};

export async function getProfile(accessToken: string): Promise<SpotifyProfile> {
  const response = await apiFetch(accessToken, "/me");
  if (!response.ok) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
  const body = (await response.json()) as {
    id: string;
    display_name?: string | null;
    product?: string | null;
    images?: Array<{ url?: string }> | null;
  };
  return {
    id: body.id,
    displayName: body.display_name?.trim() || body.id,
    product: body.product ?? null,
    imageUrl: body.images?.[0]?.url ?? null,
  };
}

/** Returns null when Spotify reports no active playback session (HTTP 204). */
export async function getPlaybackState(
  accessToken: string,
): Promise<SpotifyPlaybackState | null> {
  const response = await apiFetch(accessToken, "/me/player");
  if (response.status === 204) {
    return null;
  }
  if (!response.ok) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
  const body = (await response.json()) as {
    is_playing?: boolean;
    progress_ms?: number | null;
    device?: { id?: string | null } | null;
    item?: unknown;
  };
  return {
    isPlaying: body.is_playing === true,
    progressMs: body.progress_ms ?? 0,
    deviceId: body.device?.id ?? null,
    item: body.item ?? null,
  };
}

function withDevice(path: string, deviceId?: string): string {
  if (!deviceId) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}device_id=${encodeURIComponent(deviceId)}`;
}

/** Resume the active Spotify player without changing the current track. */
export async function resumePlayback(accessToken: string, deviceId?: string): Promise<void> {
  const response = await apiFetch(accessToken, withDevice("/me/player/play", deviceId), {
    method: "PUT",
  });
  // 403 "restriction violated" usually means already playing.
  if (!response.ok && response.status !== 204 && response.status !== 403) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
}

/** Pause the active Spotify player. */
export async function pausePlayback(accessToken: string, deviceId?: string): Promise<void> {
  const response = await apiFetch(accessToken, withDevice("/me/player/pause", deviceId), {
    method: "PUT",
  });
  // 403 here usually means already paused.
  if (!response.ok && response.status !== 204 && response.status !== 403) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
}

/** Turns a raw API failure into something worth showing in the party UI. */
export function describeSpotifyError(error: unknown): string {
  if (error instanceof SpotifyApiError) {
    if (error.status === 404) {
      // Prefer custom messages from library helpers when present.
      if (error.message && !error.message.startsWith("HTTP ")) {
        return error.message;
      }
      return "No active Spotify playback. Open Spotify and start playing something.";
    }
    if (error.status === 403) {
      if (
        error.message &&
        !error.message.startsWith("HTTP ") &&
        !/restriction|player/i.test(error.message)
      ) {
        return error.message;
      }
      return "Spotify rejected pause/play. Playback control requires Spotify Premium.";
    }
    if (error.status === 429) {
      return "Spotify rate limit reached. Retrying shortly.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Unknown Spotify error";
}

// --- Library import helpers -------------------------------------------------

export type SpotifyPlaylistSummary = {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  ownerName: string | null;
  ownerId: string | null;
  collaborative: boolean;
};

export type SpotifyTrackPage = {
  items: unknown[];
  total: number;
  nextOffset: number | null;
};

type SpotifyPaging<T> = {
  items?: T[];
  total?: number;
  next?: string | null;
  limit?: number;
  offset?: number;
};

function imageFromImages(images: unknown): string | null {
  if (!Array.isArray(images)) {
    return null;
  }
  for (const image of images) {
    if (typeof image !== "object" || image === null) {
      continue;
    }
    const url = (image as { url?: unknown }).url;
    if (typeof url === "string" && url.length > 0) {
      return url;
    }
  }
  return null;
}

/** Spotify Feb 2026: playlist size lives on `items.total` (legacy: `tracks.total`). */
function playlistTrackTotal(raw: {
  items?: { total?: number } | null;
  tracks?: { total?: number } | null;
}): number {
  return raw.items?.total ?? raw.tracks?.total ?? 0;
}

/**
 * Playlist page entries expose the track as `item` (Feb 2026) or deprecated
 * `track`. Episodes / null placeholders are skipped by the caller.
 */
export function playlistEntryPayload(entry: unknown): unknown | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const row = entry as { item?: unknown; track?: unknown };
  if (row.item !== undefined) {
    return row.item ?? null;
  }
  if (row.track !== undefined) {
    return row.track ?? null;
  }
  return null;
}

function nextPageOffset(args: {
  next: string | null | undefined;
  offset: number;
  pageSize: number;
  total: number;
}): number | null {
  const consumed = args.offset + args.pageSize;
  if (args.next || consumed < args.total) {
    return consumed;
  }
  return null;
}

/** Lists playlists the linked user can read (owned + followed). */
export async function listUserPlaylists(
  accessToken: string,
  options?: { limit?: number; offset?: number },
): Promise<{ items: SpotifyPlaylistSummary[]; total: number; nextOffset: number | null }> {
  const limit = Math.min(50, Math.max(1, options?.limit ?? 50));
  const offset = Math.max(0, options?.offset ?? 0);
  // Always paginate via /me/playlists?offset=… — Spotify's `next` URL still
  // points at the removed /users/{id}/playlists endpoint for some apps.
  const response = await apiFetch(
    accessToken,
    `/me/playlists?limit=${limit}&offset=${offset}`,
  );
  if (!response.ok) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
  const body = (await response.json()) as SpotifyPaging<{
    id?: string;
    name?: string;
    images?: unknown;
    collaborative?: boolean;
    items?: { total?: number } | null;
    tracks?: { total?: number } | null;
    owner?: { id?: string; display_name?: string | null } | null;
  }>;

  const items: SpotifyPlaylistSummary[] = [];
  for (const raw of body.items ?? []) {
    if (!raw?.id || !raw.name) {
      continue;
    }
    items.push({
      id: raw.id,
      name: raw.name,
      imageUrl: imageFromImages(raw.images),
      trackCount: playlistTrackTotal(raw),
      ownerName: raw.owner?.display_name ?? raw.owner?.id ?? null,
      ownerId: raw.owner?.id ?? null,
      collaborative: raw.collaborative === true,
    });
  }

  const total = body.total ?? offset + items.length;
  const nextOffset = nextPageOffset({
    next: body.next,
    offset,
    pageSize: items.length,
    total,
  });

  return { items, total, nextOffset };
}

/**
 * One page of tracks from a playlist (limit ≤ 50).
 * Uses `/items` (Feb 2026); `/tracks` was removed for Dev Mode apps.
 */
export async function getPlaylistTracksPage(
  accessToken: string,
  playlistId: string,
  offset: number,
  limit = 50,
): Promise<SpotifyTrackPage> {
  const safeLimit = Math.min(50, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);
  const response = await apiFetch(
    accessToken,
    `/playlists/${encodeURIComponent(playlistId)}/items?limit=${safeLimit}&offset=${safeOffset}&additional_types=track`,
  );
  if (!response.ok) {
    const detail = await readError(response);
    if (response.status === 403) {
      throw new SpotifyApiError(
        403,
        "Spotify only allows importing playlists you own or collaborate on.",
      );
    }
    if (response.status === 404) {
      throw new SpotifyApiError(404, `Playlist not found (${detail})`);
    }
    throw new SpotifyApiError(response.status, detail);
  }
  const body = (await response.json()) as SpotifyPaging<unknown>;
  const items = (body.items ?? [])
    .map((entry) => playlistEntryPayload(entry))
    .filter((track) => track !== null);

  const total = body.total ?? safeOffset + items.length;
  const nextOffset = nextPageOffset({
    next: body.next,
    offset: safeOffset,
    pageSize: body.items?.length ?? 0,
    total,
  });

  return { items, total, nextOffset };
}

/** One page of the user's Liked Songs (Saved Tracks). */
export async function getLikedTracksPage(
  accessToken: string,
  offset: number,
  limit = 50,
): Promise<SpotifyTrackPage> {
  const safeLimit = Math.min(50, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);
  const response = await apiFetch(
    accessToken,
    `/me/tracks?limit=${safeLimit}&offset=${safeOffset}`,
  );
  if (!response.ok) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
  const body = (await response.json()) as SpotifyPaging<{ track?: unknown | null }>;
  const items = (body.items ?? [])
    .map((entry) => entry.track)
    .filter((track) => track !== null && track !== undefined);

  const total = body.total ?? items.length;
  const nextOffset = nextPageOffset({
    next: body.next,
    offset: safeOffset,
    pageSize: body.items?.length ?? 0,
    total,
  });

  return { items, total, nextOffset };
}

/** Total liked-song count without fetching every page. */
export async function getLikedTracksTotal(accessToken: string): Promise<number> {
  const page = await getLikedTracksPage(accessToken, 0, 1);
  return page.total;
}
