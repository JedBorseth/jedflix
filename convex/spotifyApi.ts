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
 */
export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state",
].join(" ");

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
      return "No active Spotify playback. Open Spotify and start playing something.";
    }
    if (error.status === 403) {
      return "Spotify rejected pause/play. Playback control requires Spotify Premium.";
    }
    if (error.status === 429) {
      return "Spotify rate limit reached. Retrying shortly.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Unknown Spotify error";
}
