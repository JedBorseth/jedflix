import { DragHandleDots2Icon, Cross2Icon } from "@radix-ui/react-icons";
import { useDrag } from "@use-gesture/react";
import { useRef, useState } from "react";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import {
  useMusicPlayer,
  type MusicQueueTrack,
} from "@/components/player/music/MusicPlayerContext";
import { formatTrackDuration } from "@/lib/spotify";
import { dropIndexFromDrag } from "@/lib/musicQueue";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 64;
const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.4;

type QueueRowProps = {
  track: MusicQueueTrack;
  index: number;
  isCurrent: boolean;
  isDragging: boolean;
  dragOffsetY: number;
  onDragStart: (index: number) => void;
  onDragMove: (index: number, movementY: number) => void;
  onDragEnd: (index: number, movementY: number) => void;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
};

function QueueRow({
  track,
  index,
  isCurrent,
  isDragging,
  dragOffsetY,
  onDragStart,
  onDragMove,
  onDragEnd,
  onPlay,
  onRemove,
}: QueueRowProps) {
  const artist = track.artists.filter(Boolean).join(", ");

  const bindHandle = useDrag(
    ({ active, movement: [, my], first, last, event }) => {
      event?.stopPropagation();
      if (first) {
        onDragStart(index);
      }
      if (active) {
        onDragMove(index, my);
      }
      if (last) {
        onDragEnd(index, my);
      }
    },
    {
      axis: "y",
      filterTaps: true,
      pointer: { touch: true, capture: true },
      preventScroll: true,
    },
  );

  return (
    <li
      className={cn(
        "relative flex h-16 items-center gap-2 border-b border-zinc-800/80 px-3",
        isCurrent && "bg-zinc-900/80",
        isDragging && "z-20 bg-zinc-800 shadow-lg",
      )}
      style={
        isDragging
          ? { transform: `translateY(${dragOffsetY}px)`, touchAction: "none" }
          : undefined
      }
    >
      <button
        type="button"
        className="flex h-10 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded text-zinc-400 active:cursor-grabbing hover:bg-zinc-800 hover:text-white"
        aria-label={`Reorder ${track.title}`}
        {...bindHandle()}
      >
        <DragHandleDots2Icon className="h-5 w-5" />
      </button>

      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={() => onPlay(index)}
      >
        <ProgressiveCoverImage
          src={track.imageUrl}
          alt=""
          className="h-11 w-11 shrink-0 rounded object-cover"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium",
              isCurrent ? "text-red-400" : "text-white",
            )}
          >
            {track.title}
          </p>
          <p className="truncate text-xs text-zinc-400">{artist}</p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {formatTrackDuration(track.durationMs)}
        </span>
      </button>

      <button
        type="button"
        className="rounded p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
        aria-label={`Remove ${track.title} from queue`}
        onClick={() => onRemove(index)}
      >
        <Cross2Icon className="h-4 w-4" />
      </button>
    </li>
  );
}

export function MusicQueuePanel() {
  const {
    queue,
    queueIndex,
    queueOpen,
    setQueueOpen,
    reorderQueue,
    playQueueIndex,
    removeFromQueue,
    clearUpcoming,
  } = useMusicPlayer();
  const listRef = useRef<HTMLUListElement>(null);
  const [draggingVisualIndex, setDraggingVisualIndex] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dropVisualIndex, setDropVisualIndex] = useState<number | null>(null);
  const [sheetOffsetY, setSheetOffsetY] = useState(0);

  // Show current + upcoming only; keep earlier tracks in queue for Previous.
  const visibleQueue = queue.slice(queueIndex);
  const visibleCount = visibleQueue.length;

  const toQueueIndex = (visualIndex: number) => queueIndex + visualIndex;

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
        setQueueOpen(false);
      }
    },
    {
      axis: "y",
      filterTaps: true,
      pointer: { touch: true },
    },
  );

  if (!queueOpen) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close queue"
        onClick={() => setQueueOpen(false)}
      />

      <div
        className="relative z-10 flex max-h-[70%] flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
        style={{
          transform: sheetOffsetY > 0 ? `translateY(${sheetOffsetY}px)` : undefined,
          transition: sheetOffsetY === 0 ? "transform 180ms ease" : undefined,
        }}
        role="dialog"
        aria-label="Play queue"
      >
        <div
          className="flex touch-none flex-col items-center border-b border-zinc-800 px-4 pb-3 pt-2"
          {...bindSheetDismiss()}
        >
          <div className="mb-2 h-1 w-10 rounded-full bg-zinc-600" aria-hidden />
          <div className="flex w-full items-start justify-between gap-3">
            <div className="min-w-0 text-left">
              <p className="text-sm font-medium text-white">Queue</p>
              <p className="text-xs text-zinc-500">
                {visibleCount} {visibleCount === 1 ? "song" : "songs"}
              </p>
            </div>
            {visibleCount > 1 ? (
              <button
                type="button"
                className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  clearUpcoming();
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {draggingVisualIndex !== null &&
        dropVisualIndex !== null &&
        dropVisualIndex !== draggingVisualIndex ? (
          <div
            className="pointer-events-none absolute left-3 right-3 z-10 h-0.5 bg-red-500"
            style={{ top: `${48 + dropVisualIndex * ROW_HEIGHT}px` }}
            aria-hidden
          />
        ) : null}

        <ul
          ref={listRef}
          className="overflow-y-auto overscroll-contain touch-pan-y pb-[env(safe-area-inset-bottom)]"
        >
          {visibleQueue.map((track, visualIndex) => {
            const queueIdx = toQueueIndex(visualIndex);
            return (
              <QueueRow
                key={`${track.id}-${queueIdx}`}
                track={track}
                index={visualIndex}
                isCurrent={visualIndex === 0}
                isDragging={draggingVisualIndex === visualIndex}
                dragOffsetY={draggingVisualIndex === visualIndex ? dragOffsetY : 0}
                onDragStart={(from) => {
                  setDraggingVisualIndex(from);
                  setDropVisualIndex(from);
                  setDragOffsetY(0);
                }}
                onDragMove={(from, movementY) => {
                  setDragOffsetY(movementY);
                  setDropVisualIndex(
                    dropIndexFromDrag(from, movementY, ROW_HEIGHT, visibleCount),
                  );
                }}
                onDragEnd={(from, movementY) => {
                  const to = dropIndexFromDrag(from, movementY, ROW_HEIGHT, visibleCount);
                  if (to !== from) {
                    reorderQueue(toQueueIndex(from), toQueueIndex(to));
                  }
                  setDraggingVisualIndex(null);
                  setDropVisualIndex(null);
                  setDragOffsetY(0);
                }}
                onPlay={(from) => playQueueIndex(toQueueIndex(from))}
                onRemove={(from) => removeFromQueue(toQueueIndex(from))}
              />
            );
          })}
        </ul>
      </div>
    </div>
  );
}
