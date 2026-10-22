const CLIENT_ID_KEY = "jedflix.party.clientId";

function randomId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable per-browser id so a device keeps its seat in a party across reloads. */
export function getPartyClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) {
      return existing;
    }
    const next = randomId();
    window.localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    // Private mode or blocked storage: fall back to a per-session id.
    return randomId();
  }
}

function detectBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Browser";
}

function detectPlatform(ua: string): string {
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/macintosh|mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  if (/linux/i.test(ua)) return "Linux";
  return "Device";
}

/** Human label shown in the party member list, e.g. "Safari on iPhone". */
export function getDeviceLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (!ua) {
    return "Unknown device";
  }
  return `${detectBrowser(ua)} on ${detectPlatform(ua)}`;
}

const GUEST_TOKEN_KEY = "jedflix.party.guestToken";
let memoryGuestToken: string | null = null;

/** A private per-tab credential; it is never placed in links or member lists. */
export function getGuestPartyToken(create = false): string | null {
  try {
    memoryGuestToken =
      window.sessionStorage.getItem(GUEST_TOKEN_KEY) ?? memoryGuestToken;
  } catch {
    /* Storage may be disabled in a fresh/private browser. */
  }
  if (!memoryGuestToken && create) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    memoryGuestToken = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    try {
      window.sessionStorage.setItem(GUEST_TOKEN_KEY, memoryGuestToken);
    } catch {
      /* Keep in memory. */
    }
  }
  return memoryGuestToken;
}

export function clearGuestPartyToken() {
  memoryGuestToken = null;
  try {
    window.sessionStorage.removeItem(GUEST_TOKEN_KEY);
  } catch {
    /* Storage is optional. */
  }
}

export function partyJoinPath(code?: string): string {
  return code ? `/party/${encodeURIComponent(code)}` : "/party";
}

export function isPartyJoinPath(pathname: string): boolean {
  return pathname === "/party" || pathname.startsWith("/party/");
}

export function partyErrorMessage(error: unknown): string {
  // Convex's auth/client bundles can contain separate copies of the error class.
  if (
    error instanceof Error &&
    error.name === "ConvexError" &&
    "data" in error &&
    typeof error.data === "string"
  )
    return error.data;
  return "Could not connect to the party. Please try again.";
}
