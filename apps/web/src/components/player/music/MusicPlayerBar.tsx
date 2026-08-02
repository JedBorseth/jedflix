import { PauseIcon, PlayIcon, TrackNextIcon, TrackPreviousIcon } from "@radix-ui/react-icons";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import { useMusicPlayer } from "@/components/player/music/MusicPlayerContext";
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

export function MusicPlayerBar() {
  const {
    current,
    playing,
    loading,
    expanded,
    currentTime,
    duration,
    error,
    toggle,
    next,
    previous,
    seek,
    setExpanded,
    queue,
    queueIndex,
  } = useMusicPlayer();

  if (!current) {
    return null;
  }

  const artist = current.artists.filter(Boolean).join(", ");
  const progressMax = duration > 0 ? duration : 1;

  return (
    <>
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
        <div className="fixed inset-0 z-[60] flex flex-col bg-zinc-950 text-white">
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
              onClick={() => setExpanded(false)}
            >
              Close
            </button>
            <p className="text-xs uppercase tracking-widest text-zinc-500">Now playing</p>
            <span className="w-16" />
          </div>

          <div className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-8 px-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
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

            <div className="flex items-center gap-6">
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
        </div>
      ) : null}
    </>
  );
}
