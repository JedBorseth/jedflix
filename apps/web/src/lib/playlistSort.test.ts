import { describe, expect, test } from "bun:test";
import { DEFAULT_PLAYLIST_SORT, sortPlaylistTracks } from "./playlistSort";

const tracks = [
  {
    title: "Zebra",
    artists: ["Beta"],
    albumName: "Moon",
    addedAt: 100,
    position: 0,
  },
  {
    title: "Apple",
    artists: ["Alpha"],
    albumName: "Sun",
    addedAt: 300,
    position: 1,
  },
  {
    title: "Mango",
    artists: ["Alpha"],
    albumName: "Moon",
    addedAt: 200,
    position: 2,
  },
];

describe("sortPlaylistTracks", () => {
  test("defaults to date added", () => {
    expect(DEFAULT_PLAYLIST_SORT).toBe("addedAt");
  });

  test("sorts by date added newest first", () => {
    const sorted = sortPlaylistTracks(tracks, "addedAt");
    expect(sorted.map((track) => track.title)).toEqual([
      "Apple",
      "Mango",
      "Zebra",
    ]);
  });

  test("sorts by title", () => {
    const sorted = sortPlaylistTracks(tracks, "title");
    expect(sorted.map((track) => track.title)).toEqual([
      "Apple",
      "Mango",
      "Zebra",
    ]);
  });

  test("sorts by artist then title", () => {
    const sorted = sortPlaylistTracks(tracks, "artist");
    expect(sorted.map((track) => track.title)).toEqual([
      "Apple",
      "Mango",
      "Zebra",
    ]);
  });

  test("sorts by album then title", () => {
    const sorted = sortPlaylistTracks(tracks, "album");
    expect(sorted.map((track) => track.title)).toEqual([
      "Mango",
      "Zebra",
      "Apple",
    ]);
  });

  test("does not mutate input", () => {
    const copy = [...tracks];
    sortPlaylistTracks(tracks, "title");
    expect(tracks).toEqual(copy);
  });
});
