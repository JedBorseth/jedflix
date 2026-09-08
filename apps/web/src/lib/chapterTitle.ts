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
  if (!Number.isFinite(sec) || sec < 0) {
    return "0:00";
  }
  const total = Math.floor(sec);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
