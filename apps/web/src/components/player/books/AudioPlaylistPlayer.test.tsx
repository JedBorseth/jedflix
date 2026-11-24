import { beforeEach, test, expect } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

test("keeps the chapter duration when saved progress updates mid-playback", () => {
  const props = {
    title: "Dune",
    artist: "Frank Herbert",
    artworkUrl: "https://example.com/cover.jpg",
    files: [files[0]!],
  };
  const { container, rerender } = render(
    <AudioPlaylistPlayer {...props} initialPositionSec={0} />,
  );
  const audio = container.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { configurable: true, value: 8 * 3600 });
  fireEvent.loadedMetadata(audio);
  expect(screen.getByText("8:00:00")).toBeTruthy();

  // The parent's live progress query echoes back the position we just saved.
  rerender(<AudioPlaylistPlayer {...props} initialPositionSec={15} />);
  expect(screen.getByText("8:00:00")).toBeTruthy();
});

const singleFileBook: StreamFile[] = [
  {
    index: 0,
    fileId: 2,
    filename: "Harry Potter 1.m4b",
    url: "https://example.com/hp1.m4b",
    filesize: 1,
    chapterSource: "embedded",
    chapters: [
      { title: "Opening Credits", startSec: 0, endSec: 63 },
      { title: "Chapter 1 - The Boy Who Lived", startSec: 63, endSec: 1970 },
      { title: "Chapter 2 - The Vanishing Glass", startSec: 1970, endSec: 3318 },
    ],
  },
];

test("lists chapters inside a single-file book and seeks to them", async () => {
  const { container } = render(
    <AudioPlaylistPlayer title="Harry Potter" files={singleFileBook} />,
  );
  const audio = container.querySelector("audio")!;
  expect(screen.getByText("1. Opening Credits")).toBeTruthy();

  fireEvent.click(screen.getAllByRole("button", { name: "Open chapters" })[0]!);
  await act(async () => {
    fireEvent.click(screen.getAllByText("Chapter 2 - The Vanishing Glass")[0]!);
  });

  expect(audio.currentTime).toBe(1970);
  expect(screen.getByText("3. Chapter 2 - The Vanishing Glass")).toBeTruthy();
});

test("next and previous move between chapters within the file", async () => {
  const { container } = render(
    <AudioPlaylistPlayer title="Harry Potter" files={singleFileBook} />,
  );
  const audio = container.querySelector("audio")!;

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Next chapter" }));
  });
  expect(audio.currentTime).toBe(63);

  // Well into chapter 1, "previous" restarts it rather than going back.
  audio.currentTime = 500;
  fireEvent.timeUpdate(audio);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Previous chapter" }));
  });
  expect(audio.currentTime).toBe(63);
});
