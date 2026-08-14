import { DragHandleDots2Icon, Cross2Icon, PlusIcon } from "@radix-ui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDrag } from "@use-gesture/react";
import { useEffect, useRef, useState } from "react";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import {
  useMusicPlayer,
  type MusicQueueTrack,
} from "@/components/player/music/MusicPlayerContext";
import { artworkForTrack } from "@/lib/musicQueueArtwork";
import { formatTrackDuration } from "@/lib/spotify";
import { dropIndexFromDrag } from "@/lib/musicQueue";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 64;
const DESKTOP_ROW_HEIGHT = 56;
const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.4;

type QueueRowProps = {
  track: MusicQueueTrack;
  index: number;
  isCurrent: boolean;
  isDragging: boolean;
  dragOffsetY: number;
  compact?: boolean;
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
  compact = false,
  onDragStart,
  onDragMove,
  onDragEnd,
  onPlay,
  onRemove,
}: QueueRowProps) {
  const artist = track.artists.filter(Boolean).join(", ");
  const imageUrl = track.imageUrl || artworkForTrack(track.id);
  const artSize = compact ? "h-10 w-10" : "h-11 w-11";

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
        "relative flex items-center gap-2 border-b border-zinc-800/80 px-3",
        compact ? "h-14" : "h-16",
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
        {imageUrl ? (
          <ProgressiveCoverImage
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn("shrink-0 rounded object-cover", artSize)}
          />
        ) : (
          <div className={cn("shrink-0 rounded bg-zinc-800", artSize)} aria-hidden />
        )}
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

function UpcomingRow({
  track,
  compact = false,
  onAdd,
}: {
  track: MusicQueueTrack;
  compact?: boolean;
  onAdd: (track: MusicQueueTrack) => void;
}) {
  const artist = track.artists.filter(Boolean).join(", ");
  const imageUrl = track.imageUrl || artworkForTrack(track.id);
  const artSize = compact ? "h-8 w-8" : "h-10 w-10";

  return (
    <li>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2.5 text-left hover:bg-zinc-900/80",
          compact ? "h-10 px-4" : "h-14 px-3",
        )}
        onClick={() => onAdd(track)}
        aria-label={`Add ${track.title} to queue`}
      >
        {imageUrl ? (
          <ProgressiveCoverImage
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn("shrink-0 rounded object-cover", artSize)}
          />
        ) : (
          <div className={cn("shrink-0 rounded bg-zinc-800", artSize)} aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-200">{track.title}</p>
          <p className="truncate text-xs text-zinc-500">{artist}</p>
        </div>
        <PlusIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
      </button>
    </li>
  );
}

function InfiniteQueueToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Infinite Queue"
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        enabled
          ? "bg-red-600/20 text-red-400 hover:bg-red-600/30"
          : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      Infinite Queue
    </button>
  );
}

function useQueueDrag() {
  const [draggingVisualIndex, setDraggingVisualIndex] = useState<number | null>(
    null,
  );
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dropVisualIndex, setDropVisualIndex] = useState<number | null>(null);

  return {
    draggingVisualIndex,
    dragOffsetY,
    dropVisualIndex,
    onDragStart: (from: number) => {
      setDraggingVisualIndex(from);
      setDropVisualIndex(from);
      setDragOffsetY(0);
    },
    onDragMove: (from: number, movementY: number, rowHeight: number, count: number) => {
      setDragOffsetY(movementY);
      setDropVisualIndex(dropIndexFromDrag(from, movementY, rowHeight, count));
    },
    onDragEnd: (
      from: number,
      movementY: number,
      rowHeight: number,
      count: number,
      commit: (from: number, to: number) => void,
    ) => {
      const to = dropIndexFromDrag(from, movementY, rowHeight, count);
      if (to !== from) {
        commit(from, to);
      }
      setDraggingVisualIndex(null);
      setDropVisualIndex(null);
      setDragOffsetY(0);
    },
  };
}

export function MusicQueuePanel() {
  const player = useMusicPlayer();
  const { queueOpen } = player;

  return (
    <>
      {queueOpen ? <MobileQueueSheet player={player} /> : null}
      <DesktopQueueSidebar player={player} />
    </>
  );
}

type PlayerBag = ReturnType<typeof useMusicPlayer>;

function MobileQueueSheet({ player }: { player: PlayerBag }) {
  const {
    queue,
    queueIndex,
    setQueueOpen,
    reorderQueue,
    playQueueIndex,
    removeFromQueue,
    clearUpcoming,
    infiniteQueue,
    setInfiniteQueue,
    upcomingRecommendations,
    addUpcomingToQueue,
  } = player;
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useQueueDrag();
  const [sheetOffsetY, setSheetOffsetY] = useState(0);

  const visibleQueue = queue.slice(queueIndex);
  const visibleCount = visibleQueue.length;

  const virtualizer = useVirtualizer({
    count: visibleCount,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

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

  const virtualItems = virtualizer.getVirtualItems();
  const headerOffset = 48;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end md:hidden">
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
            <div className="flex shrink-0 items-center gap-2">
              <InfiniteQueueToggle
                enabled={infiniteQueue}
                onToggle={() => setInfiniteQueue(!infiniteQueue)}
              />
              {visibleCount > 1 ? (
                <button
                  type="button"
                  className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
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
        </div>

        {drag.draggingVisualIndex !== null &&
        drag.dropVisualIndex !== null &&
        drag.dropVisualIndex !== drag.draggingVisualIndex ? (
          <div
            className="pointer-events-none absolute left-3 right-3 z-10 h-0.5 bg-red-500"
            style={{
              top: `${headerOffset + drag.dropVisualIndex * ROW_HEIGHT - (listRef.current?.scrollTop ?? 0)}px`,
            }}
            aria-hidden
          />
        ) : null}

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y"
        >
          <ul
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const visualIndex = virtualRow.index;
              const track = visibleQueue[visualIndex];
              if (!track) {
                return null;
              }
              const queueIdx = toQueueIndex(visualIndex);
              return (
                <div
                  key={`${track.id}-${queueIdx}`}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <QueueRow
                    track={track}
                    index={visualIndex}
                    isCurrent={visualIndex === 0}
                    isDragging={drag.draggingVisualIndex === visualIndex}
                    dragOffsetY={
                      drag.draggingVisualIndex === visualIndex ? drag.dragOffsetY : 0
                    }
                    onDragStart={drag.onDragStart}
                    onDragMove={(from, movementY) =>
                      drag.onDragMove(from, movementY, ROW_HEIGHT, visibleCount)
                    }
                    onDragEnd={(from, movementY) =>
                      drag.onDragEnd(
                        from,
                        movementY,
                        ROW_HEIGHT,
                        visibleCount,
                        (a, b) => reorderQueue(toQueueIndex(a), toQueueIndex(b)),
                      )
                    }
                    onPlay={(from) => playQueueIndex(toQueueIndex(from))}
                    onRemove={(from) => removeFromQueue(toQueueIndex(from))}
                  />
                </div>
              );
            })}
          </ul>
        </div>

        {infiniteQueue && upcomingRecommendations.length > 0 ? (
          <div className="flex max-h-[8.5rem] shrink-0 flex-col border-t border-zinc-800 pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-baseline justify-between px-4 pb-1 pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Auto queue
              </p>
              <p className="text-[11px] text-zinc-600">Tap to add</p>
            </div>
            <ul className="min-h-0 overflow-y-auto overscroll-contain">
              {upcomingRecommendations.map((track) => (
                <UpcomingRow
                  key={`upcoming-${track.id}`}
                  track={track}
                  compact
                  onAdd={addUpcomingToQueue}
                />
              ))}
            </ul>
          </div>
        ) : (
          <div className="pb-[env(safe-area-inset-bottom)]" />
        )}
      </div>
    </div>
  );
}

function DesktopQueueSidebar({ player }: { player: PlayerBag }) {
  const {
    queue,
    queueIndex,
    queueOpen,
    setQueueOpen,
    reorderQueue,
    playQueueIndex,
    removeFromQueue,
    clearUpcoming,
    infiniteQueue,
    setInfiniteQueue,
    upcomingRecommendations,
    addUpcomingToQueue,
    current,
  } = player;
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useQueueDrag();

  useEffect(() => {
    if (!queueOpen) {
      return;
    }

    function onDoubleClick(event: MouseEvent) {
      if (window.matchMedia("(max-width: 767px)").matches) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        setQueueOpen(false);
        return;
      }
      if (target.closest("[data-queue-panel], [data-queue-toggle]")) {
        return;
      }
      setQueueOpen(false);
    }

    document.addEventListener("dblclick", onDoubleClick);
    return () => document.removeEventListener("dblclick", onDoubleClick);
  }, [queueOpen, setQueueOpen]);

  const upcomingQueue = queue.slice(queueIndex + 1);
  const upcomingCount = upcomingQueue.length;
  const currentTrack = current ?? queue[queueIndex] ?? null;

  const virtualizer = useVirtualizer({
    count: upcomingCount,
    getScrollElement: () => listRef.current,
    estimateSize: () => DESKTOP_ROW_HEIGHT,
    overscan: 10,
  });

  const toQueueIndex = (visualIndex: number) => queueIndex + 1 + visualIndex;
  const virtualItems = virtualizer.getVirtualItems();
  const currentArtist = currentTrack?.artists.filter(Boolean).join(", ") ?? "";
  const currentImage =
    currentTrack?.imageUrl || (currentTrack ? artworkForTrack(currentTrack.id) : "");

  return (
    <aside
      data-queue-panel=""
      className={cn(
        "fixed bottom-[4.75rem] right-0 top-[var(--navbar-offset)] z-40 hidden w-[var(--desktop-queue-width)] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-200 ease-out md:flex",
        queueOpen ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
      aria-hidden={!queueOpen}
      aria-label="Play queue"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3">
        <p className="text-sm font-semibold text-white">Now playing</p>
        <button
          type="button"
          className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          onClick={() => setQueueOpen(false)}
          aria-label="Close queue"
        >
          <Cross2Icon className="h-4 w-4" />
        </button>
      </div>

      {currentTrack ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-4 py-3">
          {currentImage ? (
            <ProgressiveCoverImage
              src={currentImage}
              alt=""
              className="h-14 w-14 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="h-14 w-14 shrink-0 rounded bg-zinc-800" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-red-400">{currentTrack.title}</p>
            <p className="truncate text-xs text-zinc-400">{currentArtist}</p>
          </div>
        </div>
      ) : null}

      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
        <div>
          <p className="text-sm font-semibold text-white">Queue</p>
          <p className="text-xs text-zinc-500">
            {upcomingCount} {upcomingCount === 1 ? "song" : "songs"}
          </p>
        </div>
        {upcomingCount > 0 ? (
          <button
            type="button"
            className="rounded-full px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            onClick={() => clearUpcoming()}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {upcomingCount === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">No upcoming songs</p>
        ) : (
          <ul
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualRow) => {
              const visualIndex = virtualRow.index;
              const track = upcomingQueue[visualIndex];
              if (!track) {
                return null;
              }
              const queueIdx = toQueueIndex(visualIndex);
              return (
                <div
                  key={`${track.id}-${queueIdx}`}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <QueueRow
                    track={track}
                    index={visualIndex}
                    isCurrent={false}
                    compact
                    isDragging={drag.draggingVisualIndex === visualIndex}
                    dragOffsetY={
                      drag.draggingVisualIndex === visualIndex ? drag.dragOffsetY : 0
                    }
                    onDragStart={drag.onDragStart}
                    onDragMove={(from, movementY) =>
                      drag.onDragMove(from, movementY, DESKTOP_ROW_HEIGHT, upcomingCount)
                    }
                    onDragEnd={(from, movementY) =>
                      drag.onDragEnd(
                        from,
                        movementY,
                        DESKTOP_ROW_HEIGHT,
                        upcomingCount,
                        (a, b) => reorderQueue(toQueueIndex(a), toQueueIndex(b)),
                      )
                    }
                    onPlay={(from) => playQueueIndex(toQueueIndex(from))}
                    onRemove={(from) => removeFromQueue(toQueueIndex(from))}
                  />
                </div>
              );
            })}
          </ul>
        )}
        {drag.draggingVisualIndex !== null &&
        drag.dropVisualIndex !== null &&
        drag.dropVisualIndex !== drag.draggingVisualIndex ? (
          <div
            className="pointer-events-none absolute left-3 right-3 z-10 h-0.5 bg-red-500"
            style={{
              top: `${drag.dropVisualIndex * DESKTOP_ROW_HEIGHT - (listRef.current?.scrollTop ?? 0)}px`,
            }}
            aria-hidden
          />
        ) : null}
      </div>

      <div className="mt-auto shrink-0 border-t border-zinc-800">
        <div className="flex items-center justify-between px-4 pb-1.5 pt-3">
          <p className="text-sm font-semibold text-white">Auto queue</p>
          <InfiniteQueueToggle
            enabled={infiniteQueue}
            onToggle={() => setInfiniteQueue(!infiniteQueue)}
          />
        </div>
        {infiniteQueue && upcomingRecommendations.length > 0 ? (
          <ul className="max-h-56 overflow-y-auto pb-2">
            {upcomingRecommendations.map((track) => (
              <UpcomingRow
                key={`upcoming-${track.id}`}
                track={track}
                onAdd={addUpcomingToQueue}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 pt-1 text-xs text-zinc-500">
            {infiniteQueue
              ? "Finding similar songs…"
              : "Turn on Infinite Queue to keep similar songs coming"}
          </p>
        )}
      </div>
    </aside>
  );
}
