import { beforeEach, test, expect } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { AudioPlaylistPlayer } from "./AudioPlaylistPlayer";
import type { StreamFile } from "@/lib/streamApi";

const files: StreamFile[] = [
  {
    index: 0,
    fileId: 1,
    filename: "lorem/chapter2.mp3",
    url: "https://example.com/a.mp3",
    filesize: 1,
  },
  {
    index: 1,
    fileId: 2,
    filename: "lorem/chapter3.mp3",
    url: "https://example.com/b.mp3",
    filesize: 1,
  },
];

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as typeof window.matchMedia;
});

test("shows a humanized chapter label instead of the file path", () => {
  render(
    <AudioPlaylistPlayer
      title="Dune"
      artist="Frank Herbert"
      artworkUrl="https://example.com/cover.jpg"
      files={files}
    />,
  );

  expect(screen.getByRole("heading", { name: "Dune" })).toBeTruthy();
  expect(screen.getByText("1. chapter 2")).toBeTruthy();
  expect(screen.queryByText(/lorem\/chapter2/)).toBeNull();
});

test("opens the chapter list with humanized titles", () => {
  render(
    <AudioPlaylistPlayer
      title="Dune"
      artist="Frank Herbert"
      artworkUrl="https://example.com/cover.jpg"
      files={files}
    />,
  );

  fireEvent.click(screen.getAllByRole("button", { name: "Open chapters" })[0]!);
  expect(screen.getAllByText("chapter 2").length).toBeGreaterThan(0);
  expect(screen.getAllByText("chapter 3").length).toBeGreaterThan(0);
});

test("puts speed on a menu trigger instead of a chip row", () => {
  render(
    <AudioPlaylistPlayer
      title="Dune"
      artist="Frank Herbert"
      artworkUrl="https://example.com/cover.jpg"
      files={files}
    />,
  );

  expect(screen.getByRole("button", { name: "Playback speed 1x" })).toBeTruthy();
  expect(screen.queryByRole("menuitemradio")).toBeNull();
  expect(screen.queryByText("0.75x")).toBeNull();
  expect(screen.getByRole("button", { name: "+30s" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open chapters" })).toBeTruthy();
});
