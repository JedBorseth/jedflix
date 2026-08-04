import { describe, expect, test } from "bun:test";
import {
  buildSpellSuggestions,
  levenshteinDistance,
  normalizeSearchText,
  textSimilarity,
} from "./searchSuggestions";

describe("searchSuggestions", () => {
  test("normalizeSearchText strips accents and punctuation", () => {
    expect(normalizeSearchText("  Inception! ")).toBe("inception");
    expect(normalizeSearchText("Beyoncé")).toBe("beyonce");
  });

  test("levenshteinDistance measures edits", () => {
    expect(levenshteinDistance("inceptoin", "inception")).toBe(2);
    expect(levenshteinDistance("same", "same")).toBe(0);
  });

  test("textSimilarity is high for near-misspellings", () => {
    expect(textSimilarity("inceptoin", "Inception")).toBeGreaterThan(0.7);
    expect(textSimilarity("abcd", "wxyz")).toBeLessThan(0.3);
  });

  test("buildSpellSuggestions returns did-you-mean for typos", () => {
    const suggestions = buildSpellSuggestions("inceptoin", [
      "Inception",
      "Interstellar",
      "Insidious",
    ]);
    expect(suggestions[0]?.label).toBe("Inception");
  });

  test("buildSpellSuggestions stays quiet when query already matches", () => {
    expect(
      buildSpellSuggestions("inception", ["Inception", "Interstellar"]),
    ).toEqual([]);
  });

  test("buildSpellSuggestions returns empty for short queries", () => {
    expect(buildSpellSuggestions("i", ["Inception"])).toEqual([]);
  });
});
