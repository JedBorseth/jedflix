import { describe, expect, test } from "bun:test";
import { formatLetterboxdUsernameError, normalizeLetterboxdUsername } from "@/lib/letterboxd";

describe("letterboxd helpers", () => {
  test("normalizeLetterboxdUsername trims and lowercases", () => {
    expect(normalizeLetterboxdUsername("  Dave_99  ")).toBe("dave_99");
  });

  test("formatLetterboxdUsernameError allows empty optional value", () => {
    expect(formatLetterboxdUsernameError("")).toBeUndefined();
    expect(formatLetterboxdUsernameError("   ")).toBeUndefined();
  });

  test("formatLetterboxdUsernameError rejects invalid usernames", () => {
    expect(formatLetterboxdUsernameError("bad name")).toBeString();
    expect(formatLetterboxdUsernameError("../x")).toBeString();
    expect(formatLetterboxdUsernameError("valid_user-1")).toBeUndefined();
  });
});
