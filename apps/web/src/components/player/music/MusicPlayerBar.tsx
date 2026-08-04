import {
  ChevronDownIcon,
  ListBulletIcon,
  PauseIcon,
  PersonIcon,
  PlayIcon,
  TrackNextIcon,
  TrackPreviousIcon,
} from "@radix-ui/react-icons";
import { useDrag } from "@use-gesture/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { useOptionalParty } from "@/components/party/partyContext";
import { useMusicPlayer } from "@/components/player/music/MusicPlayerContext";
import { MusicQueuePanel } from "@/components/player/music/MusicQueuePanel";
import { getAlbumDetailPath, getArtistPath } from "@/lib/spotify";
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
  const navigate = useNavigate();
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
  const party = useOptionalParty();

  const [swipeOffset, setSwipeOffset] = useState({ x: 0, y: 0 });
  const [miniSwipeX, setMiniSwipeX] = useState(0);

  // Expanded player: swipe on cover/handle — never the full overlay (blocks iOS taps).
  const bindExpandedSwipe = useDrag(
    ({ down, movement: [mx, my], velocity: [vx, vy], last }) => {
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
    },
  );

  // Collapsed mini player: horizontal swipe to skip/back (tap still expands).
  const bindMiniSwipe = useDrag(
    ({ down, movement: [mx, my], velocity: [vx], last, tap, event }) => {
      if (tap) {
        setMiniSwipeX(0);
        setExpanded(true);
        return;
      }

      const absX = Math.abs(mx);
      const absY = Math.abs(my);

      if (down && !last) {
        if (absX > absY) {
          event?.preventDefault?.();
          setMiniSwipeX(mx);
        }
        return;
      }

      if (!last) {
        return;
      }

      setMiniSwipeX(0);
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
      threshold: 10,
      axis: "x",
      pointer: { touch: true },
    },
  );

  if (!current) {
    return null;
  }

  const artist = current.artists.filter(Boolean).join(", ");
  const progressMax = duration > 0 ? duration : 1;
  const swipeOpacity = Math.max(0.35, 1 - swipeOffset.y / 320);
  const albumPath = current.albumId ? getAlbumDetailPath({ id: current.albumId }) : null;
  const artistEntries = current.artists
    .map((name, index) => ({
      name,
      id: current.artistIds?.[index]?.trim() || undefined,
    }))
    .filter((entry) => entry.name);

  function openArtist(artistId: string) {
    setExpanded(false);
    setQueueOpen(false);
    void navigate(getArtistPath(artistId));
  }

  function openAlbum() {
    if (!albumPath) {
      return;
    }
    setExpanded(false);
    setQueueOpen(false);
    void navigate(albumPath);
  }

  return (
    <>
      <FullscreenScrollLock enabled={expanded} />
      <div
        className="relative z-40 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md"
        role="region"
        aria-label="Now playing"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2 md:px-6">
          <div
            className="flex min-w-0 flex-1 touch-pan-y items-center gap-3 text-left"
            style={{
              transform: miniSwipeX !== 0 ? `translateX(${miniSwipeX * 0.35}px)` : undefined,
              transition: miniSwipeX === 0 ? "transform 180ms ease" : undefined,
            }}
            {...bindMiniSwipe()}
            role="button"
            tabIndex={0}
            aria-label="Open now playing. Swipe left or right to change track."
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setExpanded(true);
              }
            }}
          >
            <ProgressiveCoverImage
              src={current.imageUrl}
              alt=""
              className="pointer-events-none h-12 w-12 shrink-0 rounded object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{current.title}</p>
              <p className="truncate text-xs text-zinc-400">
                {loading ? "Finding stream…" : error ? error : artist}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {party ? (
              <button
                type="button"
                className={cn(
                  "relative rounded-full p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white",
                  party.party && "text-emerald-400",
                )}
                onClick={() => party.setPanelOpen(true)}
                aria-label={party.party ? "Party mode settings" : "Start party mode"}
              >
                <PersonIcon className="h-5 w-5" />
                {party.party ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-medium text-black">
                    {party.party.members.length}
                  </span>
                ) : null}
              </button>
            ) : null}
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
          className="fixed inset-0 z-[60] flex flex-col overflow-hidden overscroll-none bg-zinc-950 text-white"
          style={{
            transform: `translate(${swipeOffset.x * 0.35}px, ${swipeOffset.y * 0.55}px)`,
            opacity: swipeOpacity,
            transition:
              swipeOffset.x === 0 && swipeOffset.y === 0
                ? "transform 180ms ease, opacity 180ms ease"
                : undefined,
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-40 blur-3xl"
            style={{
              backgroundImage: `url(${current.imageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-zinc-950/90 to-zinc-950" />

          <div className="relative z-10 flex shrink-0 items-center justify-center px-4 pb-1 pt-[calc(0.5rem+env(safe-area-inset-top))] md:px-8">
            <button
              type="button"
              className="rounded-full p-2 text-zinc-300 hover:bg-zinc-900 hover:text-white"
              onClick={() => setExpanded(false)}
              aria-label="Minimize player"
            >
              <ChevronDownIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col px-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {/* Swipe zone: handle + cover — shrinks to fit short viewports */}
            <div
              className="flex min-h-0 w-full flex-1 touch-none flex-col items-center justify-center gap-3"
              {...bindExpandedSwipe()}
            >
              <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                <div className="aspect-square h-full max-h-[24rem] max-w-full">
                  <ProgressiveCoverImage
                    src={current.imageUrl}
                    alt={current.albumName}
                    className="h-full w-full rounded-lg object-cover shadow-2xl"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 w-full shrink-0 space-y-4">
              <div className="min-w-0 text-left">
                {albumPath ? (
                  <button
                    type="button"
                    className="block w-full truncate text-left text-xl font-semibold hover:underline sm:text-2xl"
                    onClick={openAlbum}
                  >
                    {current.title}
                  </button>
                ) : (
                  <h1 className="truncate text-xl font-semibold sm:text-2xl">{current.title}</h1>
                )}
                <p className="mt-1 truncate text-zinc-300">
                  {artistEntries.length > 0
                    ? artistEntries.map((entry, index) => (
                        <span key={`${entry.name}-${index}`}>
                          {index > 0 ? <span className="text-zinc-500">, </span> : null}
                          {entry.id ? (
                            <button
                              type="button"
                              className="hover:underline"
                              onClick={() => openArtist(entry.id!)}
                            >
                              {entry.name}
                            </button>
                          ) : (
                            entry.name
                          )}
                        </span>
                      ))
                    : artist}
                </p>
                {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
                {loading && !error ? (
                  <p className="mt-2 text-sm text-zinc-400">Resolving YouTube audio…</p>
                ) : null}
              </div>

              <div className="w-full">
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

              <div className="relative flex items-center justify-center gap-6 pb-1">
                {party ? (
                  <button
                    type="button"
                    className={cn(
                      "absolute left-0 inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-white hover:bg-zinc-800",
                      party.party && "border-emerald-500/60 text-emerald-300",
                    )}
                    onClick={() => party.setPanelOpen(true)}
                    aria-label={party.party ? "Party mode settings" : "Start party mode"}
                  >
                    <PersonIcon className="h-5 w-5" />
                    {party.party ? (
                      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-medium text-black">
                        {party.party.members.length}
                      </span>
                    ) : null}
                  </button>
                ) : null}
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

                <button
                  type="button"
                  className={cn(
                    "absolute right-0 inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/90 text-white hover:bg-zinc-800",
                    queueOpen && "border-red-500/60 text-red-300",
                  )}
                  onClick={() => setQueueOpen(!queueOpen)}
                  aria-label={queueOpen ? "Close queue" : "Open queue"}
                  aria-expanded={queueOpen}
                >
                  <ListBulletIcon className="h-5 w-5" />
                  {queue.length - queueIndex > 1 ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
                      {queue.length - queueIndex}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
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
