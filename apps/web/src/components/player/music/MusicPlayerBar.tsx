import {
  ListBulletIcon,
  PauseIcon,
  PlayIcon,
  TrackNextIcon,
  TrackPreviousIcon,
} from "@radix-ui/react-icons";
import { useDrag } from "@use-gesture/react";
import { useEffect, useRef, useState } from "react";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { useMusicPlayer } from "@/components/player/music/MusicPlayerContext";
import { MusicQueuePanel } from "@/components/player/music/MusicQueuePanel";
import { cn } from "@/lib/utils";

function formatClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) {
    return "0:00";
  }
  const total = Math.floor(sec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const SWIPE_DISTANCE = 72;
const SWIPE_VELOCITY = 0.35;

export function MusicPlayerBar() {
  const {
    current,
    playing,
    loading,
    expanded,
    queueOpen,
    currentTime,
    duration,
    error,
    toggle,
    next,
    previous,
    seek,
    setExpanded,
    setQueueOpen,
    queue,
    queueIndex,
  } = useMusicPlayer();

  const swipeSurfaceRef = useRef<HTMLDivElement>(null);
  const [swipeOffset, setSwipeOffset] = useState({ x: 0, y: 0 });

  const bindSwipe = useDrag(
    ({ down, movement: [mx, my], velocity: [vx, vy], last, cancel, event }) => {
      const target = event?.target;
      if (
        target instanceof Element &&
        (target.closest("[data-no-swipe]") || target.closest('input[type="range"]'))
      ) {
        cancel?.();
        setSwipeOffset({ x: 0, y: 0 });
        return;
      }

      if (down && !last) {
        const absX = Math.abs(mx);
        const absY = Math.abs(my);
        if (absY >= absX) {
          setSwipeOffset({ x: 0, y: Math.max(0, my) });
        } else {
          setSwipeOffset({ x: mx, y: 0 });
        }
        return;
      }

      if (!last) {
        return;
      }

      const absX = Math.abs(mx);
      const absY = Math.abs(my);
      setSwipeOffset({ x: 0, y: 0 });

      if (absY > absX && my > SWIPE_DISTANCE && (vy > SWIPE_VELOCITY || my > 140)) {
        setExpanded(false);
        return;
      }

      if (absX > absY && absX > SWIPE_DISTANCE && (vx > SWIPE_VELOCITY || absX > 140)) {
        if (mx < 0) {
          next();
        } else {
          previous();
        }
      }
    },
    {
      filterTaps: true,
      threshold: 12,
      pointer: { touch: true },
      preventScroll: true,
    },
  );

  if (!current) {
    return null;
  }

  const artist = current.artists.filter(Boolean).join(", ");
  const progressMax = duration > 0 ? duration : 1;
  const swipeOpacity = Math.max(0.35, 1 - swipeOffset.y / 320);

  return (
    <>
      <FullscreenScrollLock enabled={expanded} />
      <div
        className={cn(
          "fixed inset-x-0 z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md",
          "bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-0",
        )}
        role="region"
        aria-label="Now playing"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2 md:px-6">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={() => setExpanded(true)}
            aria-label="Open now playing"
          >
            <ProgressiveCoverImage
              src={current.imageUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{current.title}</p>
              <p className="truncate text-xs text-zinc-400">
                {loading ? "Finding stream…" : error ? error : artist}
              </p>
            </div>
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="hidden rounded-full p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white sm:inline-flex"
              onClick={previous}
              aria-label="Previous track"
            >
              <TrackPreviousIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="rounded-full bg-white p-2.5 text-black hover:bg-zinc-200"
              onClick={(event) => {
                event.stopPropagation();
                toggle();
              }}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              className="hidden rounded-full p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white sm:inline-flex"
              onClick={next}
              aria-label="Next track"
              disabled={queueIndex >= queue.length - 1}
            >
              <TrackNextIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="h-0.5 bg-zinc-900">
          <div
            className="h-full bg-red-600 transition-[width] duration-150"
            style={{ width: `${Math.min(100, (currentTime / progressMax) * 100)}%` }}
          />
        </div>
      </div>

      {expanded ? (
        <div
          ref={swipeSurfaceRef}
          className="fixed inset-0 z-[60] flex flex-col overflow-hidden overscroll-none bg-zinc-950 text-white touch-none"
          style={{
            transform: `translate(${swipeOffset.x * 0.35}px, ${swipeOffset.y * 0.55}px)`,
            opacity: swipeOpacity,
            transition: swipeOffset.x === 0 && swipeOffset.y === 0 ? "transform 180ms ease, opacity 180ms ease" : undefined,
          }}
          {...bindSwipe()}
        >
          <div
            className="absolute inset-0 opacity-40 blur-3xl"
            style={{
              backgroundImage: `url(${current.imageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-zinc-950/90 to-zinc-950" />

          <div className="relative z-10 flex items-center justify-between px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-8">
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white"
              data-no-swipe
              onClick={() => setExpanded(false)}
            >
              Close
            </button>
            <div className="flex flex-col items-center">
              <div className="mb-2 h-1 w-10 rounded-full bg-zinc-600" aria-hidden />
              <p className="text-xs uppercase tracking-widest text-zinc-500">Now playing</p>
            </div>
            <span className="w-16" />
          </div>

          <div className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-8 px-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
            <ProgressiveCoverImage
              src={current.imageUrl}
              alt={current.albumName}
              className="aspect-square w-full max-w-sm rounded-lg object-cover shadow-2xl"
            />

            <div className="w-full text-center">
              <h1 className="text-2xl font-semibold">{current.title}</h1>
              <p className="mt-1 text-zinc-300">{artist}</p>
              <p className="mt-1 text-sm text-zinc-500">{current.albumName}</p>
              {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
              {loading && !error ? (
                <p className="mt-3 text-sm text-zinc-400">Resolving YouTube audio…</p>
              ) : null}
            </div>

            <div className="w-full" data-no-swipe>
              <input
                type="range"
                min={0}
                max={progressMax}
                step={0.5}
                value={Math.min(currentTime, progressMax)}
                onChange={(event) => seek(Number(event.target.value))}
                className="w-full accent-red-600"
                aria-label="Seek"
              />
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>{formatClock(currentTime)}</span>
                <span>{formatClock(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-6" data-no-swipe>
              <button
                type="button"
                className="rounded-full p-3 text-zinc-200 hover:bg-zinc-900"
                onClick={previous}
                aria-label="Previous track"
              >
                <TrackPreviousIcon className="h-7 w-7" />
              </button>
              <button
                type="button"
                className="rounded-full bg-white p-4 text-black hover:bg-zinc-200"
                onClick={toggle}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <PauseIcon className="h-8 w-8" /> : <PlayIcon className="h-8 w-8" />}
              </button>
              <button
                type="button"
                className="rounded-full p-3 text-zinc-200 hover:bg-zinc-900 disabled:opacity-40"
                onClick={next}
                aria-label="Next track"
                disabled={queueIndex >= queue.length - 1}
              >
                <TrackNextIcon className="h-7 w-7" />
              </button>
            </div>
          </div>

          <div
            className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-20 md:right-8"
            data-no-swipe
          >
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/90 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur hover:bg-zinc-800",
                queueOpen && "border-red-500/60 text-red-300",
              )}
              onClick={() => setQueueOpen(!queueOpen)}
              aria-label={queueOpen ? "Close queue" : "Open queue"}
              aria-expanded={queueOpen}
            >
              <ListBulletIcon className="h-4 w-4" />
              Queue
              {queue.length > 1 ? (
                <span className="rounded-full bg-zinc-800 px-1.5 text-xs text-zinc-300">
                  {queue.length}
                </span>
              ) : null}
            </button>
          </div>

          <MusicQueuePanel />
        </div>
      ) : null}
    </>
  );
}

function FullscreenScrollLock({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousHtmlOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, [enabled]);
  return null;
}
