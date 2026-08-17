export const DEMO_REAL_DEBRID_API_KEY = "121212";
export const DEMO_RD_USER_HEADER = "X-Jedflix-Demo-User";
export const REAL_DEBRID_AFFILIATE_URL = "http://real-debrid.com/?id=10515937";
export const DEMO_RD_PLAY_LIMIT = 5;

const DEMO_USER_ID_KEY = "jedflix.demoRdUserId";

let demoUserId = "";

export function isDemoRealDebridKey(key: string | undefined | null): boolean {
  return typeof key === "string" && key.trim() === DEMO_REAL_DEBRID_API_KEY;
}

export function setDemoRdUserId(userId: string | null | undefined) {
  const trimmed = userId?.trim() ?? "";
  demoUserId = trimmed;
  if (typeof window === "undefined") {
    return;
  }
  if (trimmed) {
    localStorage.setItem(DEMO_USER_ID_KEY, trimmed);
  } else {
    localStorage.removeItem(DEMO_USER_ID_KEY);
  }
}

export function getDemoRdUserId(): string {
  if (demoUserId) {
    return demoUserId;
  }
  if (typeof window === "undefined") {
    return "";
  }
  const stored = localStorage.getItem(DEMO_USER_ID_KEY)?.trim() ?? "";
  if (stored) {
    demoUserId = stored;
    return stored;
  }
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `demo-${Date.now()}`;
  demoUserId = generated;
  localStorage.setItem(DEMO_USER_ID_KEY, generated);
  return generated;
}

export function getDemoRdRequestHeaders(
  realDebridToken?: string,
): Record<string, string> {
  if (!isDemoRealDebridKey(realDebridToken)) {
    return {};
  }
  const userId = getDemoRdUserId();
  if (!userId) {
    return {};
  }
  return { [DEMO_RD_USER_HEADER]: userId };
}
