import { afterEach, describe, expect, test } from "bun:test";
import {
  DEMO_RD_USER_HEADER,
  DEMO_REAL_DEBRID_API_KEY,
  getDemoRdRequestHeaders,
  isDemoRealDebridKey,
  setDemoRdUserId,
} from "@/lib/demoRealDebrid";

afterEach(() => {
  localStorage.clear();
  setDemoRdUserId("");
});

describe("demo Real Debrid key", () => {
  test("recognizes 121212 and ignores real keys", () => {
    expect(isDemoRealDebridKey("121212")).toBe(true);
    expect(isDemoRealDebridKey(" 121212 ")).toBe(true);
    expect(isDemoRealDebridKey("real-key")).toBe(false);
    expect(isDemoRealDebridKey("")).toBe(false);
    expect(isDemoRealDebridKey(undefined)).toBe(false);
  });

  test("attaches demo user header only for the demo key", () => {
    setDemoRdUserId("k57user");
    expect(getDemoRdRequestHeaders(DEMO_REAL_DEBRID_API_KEY)).toEqual({
      [DEMO_RD_USER_HEADER]: "k57user",
    });
    expect(getDemoRdRequestHeaders("other-key")).toEqual({});
  });
});
