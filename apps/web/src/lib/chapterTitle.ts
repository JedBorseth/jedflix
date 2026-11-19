import { formatPlaybackClock } from "@/lib/playbackClock";

/** Display-only: turn torrent/RD filenames into a short chapter label. */
export function humanizeChapterTitle(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    return "Chapter";
  }
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
  const withoutExt = base.replace(/\.[^./\\]+$/, "");
  const spaced = withoutExt
    .replace(/[_-]+/g, " ")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced || "Chapter";
}

export function formatAudiobookTime(sec: number): string {
  return formatPlaybackClock(Number.isFinite(sec) ? sec : 0, true);
}

/** MEDIA_ERR_ABORTED — src swaps and React remounts, not a real failure. */
export function isIgnorableAudioAbort(code: number | null | undefined): boolean {
  return code === 1;
}

export function nextChapterIndex(fileIndex: number, fileCount: number): number | null {
  if (fileCount < 2 || fileIndex < 0 || fileIndex >= fileCount - 1) {
    return null;
  }
  return fileIndex + 1;
}
