import { describe, expect, test } from "bun:test";
import {
  categoryForPickKind,
  jedsPickKey,
  pickMatchesRow,
} from "@/lib/jedsPicks";

describe("jedsPicks", () => {
  test("builds stable identity keys", () => {
    expect(jedsPickKey({ kind: "movie", movieId: 123 })).toBe("movie:123");
    expect(jedsPickKey({ kind: "tv", movieId: 456 })).toBe("tv:456");
    expect(jedsPickKey({ kind: "audiobook", workId: "OL1W" })).toBe("audiobook:OL1W");
    expect(jedsPickKey({ kind: "album", catalogId: "abc" })).toBe("album:abc");
    expect(jedsPickKey({ kind: "artist", catalogId: "xyz" })).toBe("artist:xyz");
  });

  test("maps kinds onto home-screen categories", () => {
    expect(categoryForPickKind("movie")).toBe("movie");
    expect(categoryForPickKind("tv")).toBe("tv");
    expect(categoryForPickKind("audiobook")).toBe("audiobook");
    expect(categoryForPickKind("album")).toBe("music");
    expect(categoryForPickKind("artist")).toBe("music");
  });

  test("home row only includes movies and shows", () => {
    expect(pickMatchesRow("movie", "home")).toBe(true);
    expect(pickMatchesRow("tv", "home")).toBe(true);
    expect(pickMatchesRow("audiobook", "home")).toBe(false);
    expect(pickMatchesRow("album", "music")).toBe(true);
    expect(pickMatchesRow("artist", "audiobook")).toBe(false);
  });
});
