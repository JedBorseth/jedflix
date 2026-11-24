import { describe, expect, test } from "bun:test";
import {
  buildBookChapters,
  chapterLength,
  currentBookChapterIndex,
  previousBookChapterIndex,
} from "./bookChapters";
import type { StreamFile } from "@/lib/streamApi";

function file(filename: string, extra: Partial<StreamFile> = {}): StreamFile {
  return { index: 0, fileId: 1, filename, url: `https://dl.example/${filename}`, filesize: 1, ...extra };
}

const hp1 = file("Harry Potter 1.m4b", {
  chapters: [
    { title: "Opening Credits", startSec: 0, endSec: 63 },
    { title: "Chapter 1 - The Boy Who Lived", startSec: 63, endSec: 1970 },
    { title: "Chapter 2 - The Vanishing Glass", startSec: 1970, endSec: 3318 },
  ],
  chapterSource: "embedded",
});

describe("buildBookChapters", () => {
  test("uses markers inside a single file", () => {
    const chapters = buildBookChapters([hp1], { 0: 31285 });
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Opening Credits",
      "Chapter 1 - The Boy Who Lived",
      "Chapter 2 - The Vanishing Glass",
    ]);
    expect(chapters.every((chapter) => chapter.fileIndex === 0)).toBe(true);
  });

  test("splits one long unmarked file into 30-minute parts", () => {
    const chapters = buildBookChapters([file("book.mp3")], { 0: 2 * 3600 + 600 });
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Part 1",
      "Part 2",
      "Part 3",
      "Part 4",
      "Part 5",
    ]);
    expect(chapters[4]).toMatchObject({ startSec: 7200, endSec: 7800 });
  });

  test("keeps a short unmarked file as one entry", () => {
    expect(buildBookChapters([file("short.mp3")], { 0: 1200 })).toHaveLength(1);
    expect(buildBookChapters([file("unknown.mp3")], {})).toHaveLength(1);
  });

  test("lists one entry per file for chapter packs", () => {
    const chapters = buildBookChapters([file("01 Intro.mp3"), file("02 Start.mp3")], { 0: 90 });
    expect(chapters.map((chapter) => [chapter.fileIndex, chapter.title])).toEqual([
      [0, "01 Intro"],
      [1, "02 Start"],
    ]);
    expect(chapterLength(chapters[0]!)).toBe(90);
    expect(chapterLength(chapters[1]!)).toBeUndefined();
  });
});

describe("chapter navigation", () => {
  const chapters = buildBookChapters([hp1], { 0: 31285 });

  test("finds the chapter at a position", () => {
    expect(currentBookChapterIndex(chapters, 0, 10)).toBe(0);
    expect(currentBookChapterIndex(chapters, 0, 62.8)).toBe(1);
    expect(currentBookChapterIndex(chapters, 0, 2500)).toBe(2);
  });

  test("finds per-file chapters in packs", () => {
    const pack = buildBookChapters([file("a.mp3"), file("b.mp3")], {});
    expect(currentBookChapterIndex(pack, 1, 500)).toBe(1);
  });

  test("previous restarts the chapter unless near its start", () => {
    expect(previousBookChapterIndex(chapters, 2, 2500)).toBe(2);
    expect(previousBookChapterIndex(chapters, 2, 1971)).toBe(1);
    expect(previousBookChapterIndex(chapters, 0, 1)).toBe(0);
  });
});
