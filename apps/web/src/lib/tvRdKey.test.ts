import { expect, test } from "bun:test";
import {
  isTvPairingPath,
  isValidTvRdCode,
  tvRdKeyApiUrl,
} from "@/lib/tvRdKey";

test("accepts high-entropy pairing codes", () => {
  expect(isValidTvRdCode("abcdefghijklmnopqrst")).toBe(true);
  expect(isValidTvRdCode("short")).toBe(false);
  expect(isValidTvRdCode("abcdefghijklmnop/x")).toBe(false);
});

test("identifies TV pairing routes", () => {
  expect(isTvPairingPath("/tv/rd/abc")).toBe(true);
  expect(isTvPairingPath("/settings")).toBe(false);
});

test("builds the backend dropbox URL", () => {
  expect(tvRdKeyApiUrl("abc_def-1234567890", "/status")).toBe(
    "/backend/api/v1/tv/rd-key/abc_def-1234567890/status",
  );
});
