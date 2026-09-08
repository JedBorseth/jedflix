import { Cross2Icon, ListBulletIcon } from "@radix-ui/react-icons";
import { useDrag } from "@use-gesture/react";
import { useEffect, useState } from "react";
import {
  formatAudiobookTime,
  humanizeChapterTitle,
} from "@/lib/chapterTitle";
import { cn } from "@/lib/utils";
import type { PackKind, StreamFile } from "@/lib/streamApi";

const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.4;

type ChapterQueuePanelProps = {
  files: StreamFile[];
  fileIndex: number;
  packKind?: PackKind;
  durations: Record<number, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (index: number) => void;
};

export function ChapterQueuePanel({
  files,
  fileIndex,
  packKind,
  durations,
  open,
  onOpenChange,
  onSelect,
}: ChapterQueuePanelProps) {
  if (files.length < 2) {
    return null;
  }

  const listLabel = packKind === "series" ? "Books" : "Chapters";

  return (
    <>
      {open ? (
        <MobileChapterSheet
          files={files}
          fileIndex={fileIndex}
          durations={durations}
          listLabel={listLabel}
          onClose={() => onOpenChange(false)}
          onSelect={onSelect}
        />
      ) : null}
      {open ? (
        <DesktopChapterSidebar
          files={files}
          fileIndex={fileIndex}
          durations={durations}
          listLabel={listLabel}
          onClose={() => onOpenChange(false)}
          onSelect={onSelect}
        />
      ) : null}
    </>
  );
}

export function ChaptersToggleButton({
  open,
  count,
  onClick,
  className,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
  className?: string;
}) {
  if (count < 2) {
    return null;
  }
  return (
    <button
      type="button"
      className={cn(
        "relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-white hover:bg-zinc-800",
        open && "border-red-500/60 text-red-300",
        className,
      )}
      data-chapters-toggle=""
      onClick={onClick}
      aria-label={open ? "Close chapters" : "Open chapters"}
      aria-expanded={open}
    >
      <ListBulletIcon className="h-5 w-5" />
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
        {count}
      </span>
    </button>
  );
}

function ChapterRows({
  files,
  fileIndex,
  durations,
  onSelect,
  compact,
}: {
  files: StreamFile[];
  fileIndex: number;
  durations: Record<number, number>;
  onSelect: (index: number) => void;
  compact?: boolean;
}) {
  return (
    <ul>
      {files.map((file, index) => {
        const isCurrent = index === fileIndex;
        const duration = durations[index];
        return (
          <li key={`${file.fileId}-${index}`}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-zinc-800/80 px-4 text-left",
                compact ? "h-14" : "h-16",
                isCurrent && "bg-zinc-900/80",
              )}
            >
              <span
                className={cn(
                  "w-6 shrink-0 text-center text-sm tabular-nums",
                  isCurrent ? "text-red-400" : "text-zinc-500",
                )}
              >
                {isCurrent ? "▶" : index + 1}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm font-medium",
                  isCurrent ? "text-red-400" : "text-white",
                )}
              >
                {humanizeChapterTitle(file.filename)}
              </span>
              {duration != null && duration > 0 ? (
                <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {formatAudiobookTime(duration)}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MobileChapterSheet({
  files,
  fileIndex,
  durations,
  listLabel,
  onClose,
  onSelect,
}: {
  files: StreamFile[];
  fileIndex: number;
  durations: Record<number, number>;
  listLabel: string;
  onClose: () => void;
  onSelect: (index: number) => void;
}) {
  const [sheetOffsetY, setSheetOffsetY] = useState(0);

  useEffect(() => {
    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = documentElement.style.overflow;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  const bindSheetDismiss = useDrag(
    ({ down, movement: [, my], velocity: [, vy], last }) => {
      const offset = Math.max(0, my);
      if (down && !last) {
        setSheetOffsetY(offset);
        return;
      }
      if (!last) {
        return;
      }
      setSheetOffsetY(0);
      if (offset > DISMISS_DISTANCE || vy > DISMISS_VELOCITY) {
        onClose();
      }
    },
    {
      axis: "y",
      filterTaps: true,
      pointer: { touch: true },
    },
  );

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close chapters"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[70%] flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
        style={{
          transform: sheetOffsetY > 0 ? `translateY(${sheetOffsetY}px)` : undefined,
          transition: sheetOffsetY === 0 ? "transform 180ms ease" : undefined,
        }}
        role="dialog"
        aria-label={listLabel}
      >
        <div
          className="flex touch-none flex-col items-center border-b border-zinc-800 px-4 pb-3 pt-2"
          {...bindSheetDismiss()}
        >
          <div className="mb-2 h-1 w-10 rounded-full bg-zinc-600" aria-hidden />
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0 text-left">
              <p className="text-sm font-medium text-white">{listLabel}</p>
              <p className="text-xs text-zinc-500">
                {files.length} {files.length === 1 ? "file" : "files"}
              </p>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <ChapterRows
            files={files}
            fileIndex={fileIndex}
            durations={durations}
            onSelect={(index) => {
              onSelect(index);
              onClose();
            }}
            compact
          />
        </div>
      </div>
    </div>
  );
}

function DesktopChapterSidebar({
  files,
  fileIndex,
  durations,
  listLabel,
  onClose,
  onSelect,
}: {
  files: StreamFile[];
  fileIndex: number;
  durations: Record<number, number>;
  listLabel: string;
  onClose: () => void;
  onSelect: (index: number) => void;
}) {
  return (
    <aside
      data-chapters-panel=""
      className="hidden min-h-0 w-[var(--desktop-queue-width)] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950 md:flex"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{listLabel}</p>
          <p className="text-xs text-zinc-500">
            {files.length} {files.length === 1 ? "file" : "files"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          onClick={onClose}
          aria-label="Close chapters"
        >
          <Cross2Icon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChapterRows
          files={files}
          fileIndex={fileIndex}
          durations={durations}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
}
