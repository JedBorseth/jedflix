export const DEMO_RD_USER_HEADER = "X-Jedflix-Demo-User";
export const REAL_DEBRID_AFFILIATE_URL = "http://real-debrid.com/?id=10515937";

const DEMO_USER_ID_KEY = "jedflix.demoRdUserId";

let demoUserId = "";

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

/** Sent on stream API calls so demo play counts are per user. */
export function getDemoRdRequestHeaders(
  realDebridToken?: string,
): Record<string, string> {
  if (!realDebridToken?.trim()) {
    return {};
  }
  const userId = getDemoRdUserId();
  if (!userId) {
    return {};
  }
  return { [DEMO_RD_USER_HEADER]: userId };
}
