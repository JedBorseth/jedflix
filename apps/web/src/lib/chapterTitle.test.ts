import { describe, expect, test } from "bun:test";
import {
  formatAudiobookTime,
  humanizeChapterTitle,
  isIgnorableAudioAbort,
  nextChapterIndex,
} from "./chapterTitle";

describe("humanizeChapterTitle", () => {
  test("strips path and extension and splits letters from numbers", () => {
    expect(humanizeChapterTitle("lorem/chapter2.mp3")).toBe("chapter 2");
  });

  test("turns underscores and dashes into spaces", () => {
    expect(humanizeChapterTitle("Chapter_02_-_The_Tower.m4b")).toBe(
      "Chapter 02 The Tower",
    );
  });

  test("uses basename when the path has folders", () => {
    expect(humanizeChapterTitle("Disc 1/Chapter 03.mp3")).toBe("Chapter 03");
  });

  test("collapses leftover whitespace", () => {
    expect(humanizeChapterTitle("  foo///bar  12.mp3  ")).toBe("bar 12");
  });

  test("falls back when the name is empty", () => {
    expect(humanizeChapterTitle("")).toBe("Chapter");
    expect(humanizeChapterTitle(".mp3")).toBe("Chapter");
  });
});

describe("formatAudiobookTime", () => {
  test("formats minutes and hours", () => {
    expect(formatAudiobookTime(5)).toBe("0:05");
    expect(formatAudiobookTime(75)).toBe("1:15");
    expect(formatAudiobookTime(3723)).toBe("1:02:03");
  });
});

describe("audiobook playback helpers", () => {
  test("ignores MEDIA_ERR_ABORTED", () => {
    expect(isIgnorableAudioAbort(1)).toBe(true);
    expect(isIgnorableAudioAbort(2)).toBe(false);
    expect(isIgnorableAudioAbort(undefined)).toBe(false);
  });

  test("advances to the next file until the last chapter", () => {
    expect(nextChapterIndex(0, 3)).toBe(1);
    expect(nextChapterIndex(1, 3)).toBe(2);
    expect(nextChapterIndex(2, 3)).toBe(null);
    expect(nextChapterIndex(0, 1)).toBe(null);
  });
});
