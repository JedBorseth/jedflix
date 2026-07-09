import { describe, expect, test } from "bun:test";
import { isMediaReleased } from "@/lib/types";

describe("isMediaReleased", () => {
  const now = new Date(2026, 6, 6);

  test("returns false when release date is in the future", () => {
    expect(
      isMediaReleased({ releaseDate: "2027-01-15", year: 2027 }, now),
    ).toBe(false);
  });

  test("returns true when release date is today or earlier", () => {
    expect(
      isMediaReleased({ releaseDate: "2026-07-06", year: 2026 }, now),
    ).toBe(true);
    expect(
      isMediaReleased({ releaseDate: "2020-05-01", year: 2020 }, now),
    ).toBe(true);
  });

  test("returns false when only year is in the future", () => {
    expect(isMediaReleased({ releaseDate: null, year: 2028 }, now)).toBe(false);
  });

  test("returns true when release info is missing or current", () => {
    expect(isMediaReleased({ releaseDate: null, year: 2024 }, now)).toBe(true);
    expect(isMediaReleased({ releaseDate: null, year: null }, now)).toBe(true);
  });
});
