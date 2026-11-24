import { humanizeChapterTitle } from "@/lib/chapterTitle";
import type { StreamFile } from "@/lib/streamApi";

/** One entry in the audiobook chapter list, possibly inside a longer file. */
export type BookChapter = {
  fileIndex: number;
  title: string;
  startSec: number;
  /** Unknown until the file's duration loads (file-per-chapter packs). */
  endSec?: number;
};

/** Single files longer than this get fixed-length parts when they have no markers. */
export const FALLBACK_PART_MIN_DURATION_SEC = 45 * 60;
export const FALLBACK_PART_LENGTH_SEC = 30 * 60;

/** Pressing "previous" this far into a chapter restarts it instead. */
export const RESTART_CHAPTER_THRESHOLD_SEC = 3;

/**
 * Builds the chapter list: markers inside a file when the backend found them,
 * otherwise one entry per file, and for one long unmarked file, 30-minute parts.
 */
export function buildBookChapters(
  files: StreamFile[],
  durations: Record<number, number>,
): BookChapter[] {
  const chapters: BookChapter[] = [];
  files.forEach((file, fileIndex) => {
    const marked = file.chapters?.filter((chapter) => chapter.endSec > chapter.startSec) ?? [];
    if (marked.length >= 2) {
      for (const chapter of marked) {
        chapters.push({
          fileIndex,
          title: chapter.title,
          startSec: chapter.startSec,
          endSec: chapter.endSec,
        });
      }
      return;
    }
    const duration = durations[fileIndex];
    if (files.length === 1 && duration != null && duration >= FALLBACK_PART_MIN_DURATION_SEC) {
      const parts = Math.ceil(duration / FALLBACK_PART_LENGTH_SEC);
      for (let part = 0; part < parts; part += 1) {
        chapters.push({
          fileIndex,
          title: `Part ${part + 1}`,
          startSec: part * FALLBACK_PART_LENGTH_SEC,
          endSec: Math.min(duration, (part + 1) * FALLBACK_PART_LENGTH_SEC),
        });
      }
      return;
    }
    chapters.push({
      fileIndex,
      title: humanizeChapterTitle(file.filename),
      startSec: 0,
      endSec: duration != null && duration > 0 ? duration : undefined,
    });
  });
  return chapters;
}

/** The chapter playing at `timeSec` of file `fileIndex`, or -1. */
export function currentBookChapterIndex(
  chapters: BookChapter[],
  fileIndex: number,
  timeSec: number,
): number {
  let found = -1;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.fileIndex !== fileIndex) {
      if (found >= 0) {
        break;
      }
      continue;
    }
    // Small lead so a seek to a chapter start lands in that chapter.
    if (found < 0 || chapter.startSec <= timeSec + 0.5) {
      found = index;
    }
  }
  return found;
}

/** Where "previous" goes: the current chapter's start, or the one before. */
export function previousBookChapterIndex(
  chapters: BookChapter[],
  currentIndex: number,
  timeSec: number,
): number {
  const current = chapters[currentIndex];
  if (!current) {
    return -1;
  }
  if (timeSec - current.startSec > RESTART_CHAPTER_THRESHOLD_SEC || currentIndex === 0) {
    return currentIndex;
  }
  return currentIndex - 1;
}

export function chapterLength(chapter: BookChapter): number | undefined {
  if (chapter.endSec == null || chapter.endSec <= chapter.startSec) {
    return undefined;
  }
  return chapter.endSec - chapter.startSec;
}
