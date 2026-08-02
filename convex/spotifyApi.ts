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
 * Playback control needs the modify scope; the poller needs the read scopes.
 * `user-read-private` is only used to label the linked account in the UI.
 */
export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
};

export type SpotifyDevice = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
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

export async function listDevices(accessToken: string): Promise<SpotifyDevice[]> {
  const response = await apiFetch(accessToken, "/me/player/devices");
  if (!response.ok) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
  const body = (await response.json()) as {
    devices?: Array<{
      id?: string | null;
      name?: string;
      type?: string;
      is_active?: boolean;
      is_restricted?: boolean;
    }>;
  };
  return (body.devices ?? [])
    .filter((device): device is { id: string } & typeof device => Boolean(device.id))
    .map((device) => ({
      id: device.id,
      name: device.name ?? "Spotify device",
      type: device.type ?? "Unknown",
      isActive: device.is_active === true,
      isRestricted: device.is_restricted === true,
    }));
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
  return deviceId ? `${path}?device_id=${encodeURIComponent(deviceId)}` : path;
}

export async function startPlayback(
  accessToken: string,
  args: { uris: string[]; deviceId?: string },
): Promise<void> {
  const response = await apiFetch(accessToken, withDevice("/me/player/play", args.deviceId), {
    method: "PUT",
    body: { uris: args.uris },
  });
  if (!response.ok && response.status !== 204) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
}

export async function resumePlayback(accessToken: string, deviceId?: string): Promise<void> {
  const response = await apiFetch(accessToken, withDevice("/me/player/play", deviceId), {
    method: "PUT",
  });
  // Spotify answers 403 "restriction violated" when the device is already
  // playing, which is the state we wanted anyway.
  if (!response.ok && response.status !== 204 && response.status !== 403) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
}

export async function pausePlayback(accessToken: string, deviceId?: string): Promise<void> {
  const response = await apiFetch(accessToken, withDevice("/me/player/pause", deviceId), {
    method: "PUT",
  });
  // 403 here usually means "already paused", which is not worth surfacing.
  if (!response.ok && response.status !== 204 && response.status !== 403) {
    throw new SpotifyApiError(response.status, await readError(response));
  }
}

/** Turns a raw API failure into something worth showing next to a device picker. */
export function describeSpotifyError(error: unknown): string {
  if (error instanceof SpotifyApiError) {
    if (error.status === 404) {
      return "No active Spotify device. Open Spotify and start playing something once.";
    }
    if (error.status === 403) {
      return "Spotify rejected the request. Playback control requires Spotify Premium.";
    }
    if (error.status === 429) {
      return "Spotify rate limit reached. Retrying shortly.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Unknown Spotify error";
}
