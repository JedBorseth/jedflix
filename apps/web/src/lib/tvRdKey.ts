import { getBackendApiBase } from "@/lib/backendEnv";

export const TV_RD_CODE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const REAL_DEBRID_API_KEY_URL = "https://real-debrid.com/apitoken";

export type TvRdKeyStatus = "pending" | "submitted" | "missing";

export function isTvPairingPath(pathname: string): boolean {
  return pathname.startsWith("/tv/");
}

export function isValidTvRdCode(code: string): boolean {
  return TV_RD_CODE_PATTERN.test(code);
}

export function tvRdKeyApiUrl(code: string, suffix = ""): string {
  const base = getBackendApiBase().replace(/\/$/, "");
  return `${base}/api/v1/tv/rd-key/${encodeURIComponent(code)}${suffix}`;
}

export async function fetchTvRdKeyStatus(code: string): Promise<TvRdKeyStatus> {
  const response = await fetch(tvRdKeyApiUrl(code, "/status"));
  if (response.status === 400) {
    return "missing";
  }
  if (!response.ok) {
    throw new Error("Could not check this pairing code.");
  }
  const body = (await response.json()) as { status?: string };
  if (body.status === "pending" || body.status === "submitted" || body.status === "missing") {
    return body.status;
  }
  return "missing";
}

export async function submitTvRdKey(code: string, apiKey: string): Promise<void> {
  const response = await fetch(tvRdKeyApiUrl(code), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (response.status === 404) {
    throw new Error("This code expired. Ask the TV to show a new QR code.");
  }
  if (response.status === 409) {
    throw new Error("This TV already received a key. Ask it to show a new QR code if you need to send another.");
  }
  if (!response.ok) {
    throw new Error("Could not send the API key. Try again.");
  }
}
