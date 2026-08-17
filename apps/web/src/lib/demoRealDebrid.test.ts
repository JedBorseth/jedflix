import { afterEach, describe, expect, test } from "bun:test";
import {
  DEMO_RD_USER_HEADER,
  getDemoRdRequestHeaders,
  setDemoRdUserId,
} from "@/lib/demoRealDebrid";

afterEach(() => {
  localStorage.clear();
  setDemoRdUserId("");
});

describe("demo Real Debrid client headers", () => {
  test("attaches demo user header when a token is present", () => {
    setDemoRdUserId("k57user");
    expect(getDemoRdRequestHeaders("any-token")).toEqual({
      [DEMO_RD_USER_HEADER]: "k57user",
    });
    expect(getDemoRdRequestHeaders("")).toEqual({});
  });
});
