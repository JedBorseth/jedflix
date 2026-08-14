import { describe, expect, test } from "bun:test";
import { mediaHomeForPath } from "@/lib/mediaHome";

describe("mediaHomeForPath", () => {
  test("maps each media detail route to its browse home", () => {
    expect(mediaHomeForPath("/movie/123")).toEqual({ to: "/movies", label: "Movies" });
    expect(mediaHomeForPath("/show/99")).toEqual({ to: "/shows", label: "Shows" });
    expect(mediaHomeForPath("/audiobook/OL1W")).toEqual({
      to: "/audiobooks",
      label: "Audiobooks",
    });
    expect(mediaHomeForPath("/author/OL1A")).toEqual({
      to: "/audiobooks",
      label: "Audiobooks",
    });
    expect(mediaHomeForPath("/album/mbid")).toEqual({ to: "/music", label: "Music" });
    expect(mediaHomeForPath("/music-artist/mbid")).toEqual({
      to: "/music",
      label: "Music",
    });
    expect(mediaHomeForPath("/music/playlist/abc")).toEqual({
      to: "/music",
      label: "Music",
    });
    expect(mediaHomeForPath("/music/liked")).toEqual({ to: "/music", label: "Music" });
    expect(mediaHomeForPath("/music/library")).toEqual({ to: "/music", label: "Music" });
    expect(mediaHomeForPath("/person/42")).toEqual({ to: "/", label: "Home" });
  });

  test("returns null on browse homes and unrelated routes", () => {
    expect(mediaHomeForPath("/")).toBeNull();
    expect(mediaHomeForPath("/movies")).toBeNull();
    expect(mediaHomeForPath("/music")).toBeNull();
    expect(mediaHomeForPath("/search")).toBeNull();
    expect(mediaHomeForPath("/settings")).toBeNull();
  });
});
