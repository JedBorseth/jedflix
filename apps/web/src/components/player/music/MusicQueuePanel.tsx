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
  } = useMusicPlayer();
  const listRef = useRef<HTMLUListElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  if (!queueOpen) {
    return null;
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex max-h-[70%] flex-col rounded-t-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
      onPointerDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="Play queue"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">Queue</p>
          <p className="text-xs text-zinc-500">
            {queue.length} {queue.length === 1 ? "song" : "songs"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white"
          onClick={() => setQueueOpen(false)}
        >
          Done
        </button>
      </div>

      {draggingIndex !== null && dropIndex !== null && dropIndex !== draggingIndex ? (
        <div
          className="pointer-events-none absolute left-3 right-3 z-10 h-0.5 bg-red-500"
          style={{ top: `${48 + dropIndex * ROW_HEIGHT}px` }}
          aria-hidden
        />
      ) : null}

      <ul
        ref={listRef}
        className="overflow-y-auto overscroll-contain touch-pan-y pb-[env(safe-area-inset-bottom)]"
      >
        {queue.map((track, index) => (
          <QueueRow
            key={`${track.id}-${index}`}
            track={track}
            index={index}
            isCurrent={index === queueIndex}
            isDragging={draggingIndex === index}
            dragOffsetY={draggingIndex === index ? dragOffsetY : 0}
            onDragStart={(from) => {
              setDraggingIndex(from);
              setDropIndex(from);
              setDragOffsetY(0);
            }}
            onDragMove={(from, movementY) => {
              setDragOffsetY(movementY);
              setDropIndex(dropIndexFromDrag(from, movementY, ROW_HEIGHT, queue.length));
            }}
            onDragEnd={(from, movementY) => {
              const to = dropIndexFromDrag(from, movementY, ROW_HEIGHT, queue.length);
              if (to !== from) {
                reorderQueue(from, to);
              }
              setDraggingIndex(null);
              setDropIndex(null);
              setDragOffsetY(0);
            }}
            onPlay={playQueueIndex}
            onRemove={removeFromQueue}
          />
        ))}
      </ul>
    </div>
  );
}
