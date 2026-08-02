const CLIENT_ID_KEY = "jedflix.party.clientId";

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
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
