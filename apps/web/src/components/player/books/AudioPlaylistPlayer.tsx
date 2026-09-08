import { PauseIcon, PlayIcon, TrackNextIcon, TrackPreviousIcon } from "@radix-ui/react-icons";
import { useEffect, useRef, useState } from "react";
import { ProgressiveCoverImage } from "@/components/browse/ProgressiveCoverImage";
import {
  ChapterQueuePanel,
  ChaptersToggleButton,
} from "@/components/player/books/ChapterQueuePanel";
import { mapMediaElementError } from "@/components/player/shared/playbackErrors";
import { useMediaSession } from "@/hooks/useMediaSession";
import {
  formatAudiobookTime,
  humanizeChapterTitle,
  isIgnorableAudioAbort,
  nextChapterIndex,
} from "@/lib/chapterTitle";
import { playMediaElement } from "@/lib/mediaSession";
import { cn } from "@/lib/utils";
import type { PackKind, StreamFile } from "@/lib/streamApi";

type AudioPlaylistPlayerProps = {
  title: string;
  artist?: string;
  artworkUrl?: string | null;
  files: StreamFile[];
  packKind?: PackKind;
  initialFileIndex?: number;
  initialPositionSec?: number;
  onProgress?: (progress: { fileIndex: number; positionSec: number }) => void;
};

function applyInitialSeek(
  audio: HTMLAudioElement,
  options: {
    fileIndex: number;
    initialFileIndex: number;
    initialPositionSec: number;
    seekAppliedRef: { current: boolean };
  },
) {
  if (
    options.seekAppliedRef.current ||
    options.fileIndex !== options.initialFileIndex ||
    options.initialPositionSec <= 0
  ) {
    return;
  }
  audio.currentTime = options.initialPositionSec;
  options.seekAppliedRef.current = true;
}

export function AudioPlaylistPlayer({
  title,
  artist,
  artworkUrl,
  files,
  packKind,
  initialFileIndex = 0,
  initialPositionSec = 0,
  onProgress,
}: AudioPlaylistPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [fileIndex, setFileIndex] = useState(
    Math.min(Math.max(initialFileIndex, 0), Math.max(files.length - 1, 0)),
  );
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(initialPositionSec);
  const [duration, setDuration] = useState(0);
  const [durations, setDurations] = useState<Record<number, number>>({});
  const [rate, setRate] = useState(1);
  const [playbackError, setPlaybackError] = useState<string>();
  const [chaptersOpen, setChaptersOpen] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );
  const seekAppliedRef = useRef(false);
  const playIntentRef = useRef(false);
  const advancingRef = useRef(false);
  const fileIndexRef = useRef(fileIndex);
  const filesRef = useRef(files);
  const currentRef = useRef(current);
  const durationRef = useRef(duration);
  fileIndexRef.current = fileIndex;
  filesRef.current = files;
  currentRef.current = current;
  durationRef.current = duration;

  const currentFile = files[fileIndex];
  const chapterTitle = currentFile
    ? humanizeChapterTitle(currentFile.filename)
    : undefined;
  const chapterLabel =
    files.length > 1 && chapterTitle
      ? `${fileIndex + 1}. ${chapterTitle}`
      : chapterTitle;

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (!query.matches) {
        setChaptersOpen(false);
      }
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    seekAppliedRef.current = false;
    setCurrent(fileIndex === initialFileIndex ? initialPositionSec : 0);
    setPlaybackError(undefined);
    setLoading(true);
    setDuration(0);
  }, [fileIndex, initialFileIndex, initialPositionSec, currentFile?.url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = rate;
  }, [rate, currentFile?.url]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused) {
        return;
      }
      onProgress?.({
        fileIndex: fileIndexRef.current,
        positionSec: Math.floor(audio.currentTime),
      });
    }, 15000);
    return () => window.clearInterval(interval);
  }, [onProgress]);

  async function startPlayback(audio: HTMLAudioElement) {
    playIntentRef.current = true;
    setPlaying(true);
    applyInitialSeek(audio, {
      fileIndex: fileIndexRef.current,
      initialFileIndex,
      initialPositionSec,
      seekAppliedRef,
    });
    const result = await playMediaElement(audio);
    if (result.status === "error") {
      setPlaybackError(`Could not start playback: ${result.error.message}`);
      playIntentRef.current = false;
      setPlaying(false);
      return;
    }
    if (result.status === "playing") {
      setPlaying(true);
      setPlaybackError(undefined);
      return;
    }
    setPlaying(!audio.paused);
  }

  function playFile(index: number, autoplay: boolean) {
    if (index !== fileIndexRef.current) {
      advancingRef.current = true;
    } else {
      advancingRef.current = false;
    }
    playIntentRef.current = autoplay;
    setFileIndex(index);
    setPlaying(autoplay);
  }

  function handleTrackEnded() {
    if (advancingRef.current) {
      return;
    }
    advancingRef.current = true;
    const index = fileIndexRef.current;
    onProgress?.({
      fileIndex: index,
      positionSec: Math.floor(durationRef.current || currentRef.current),
    });
    const next = nextChapterIndex(index, filesRef.current.length);
    if (next != null) {
      playIntentRef.current = true;
      setFileIndex(next);
      setPlaying(true);
      return;
    }
    playIntentRef.current = false;
    advancingRef.current = false;
    setPlaying(false);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio || loading) {
      return;
    }
    if (audio.paused) {
      void startPlayback(audio);
    } else {
      playIntentRef.current = false;
      audio.pause();
      setPlaying(false);
    }
  }

  function skip(delta: number) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
    setCurrent(audio.currentTime);
  }

  function seekTo(timeSec: number) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const next = Math.max(0, Math.min(audio.duration || 0, timeSec));
    audio.currentTime = next;
    setCurrent(next);
  }

  useMediaSession({
    title,
    artist: artist || "Audiobook",
    album: chapterLabel || title,
    artworkUrl,
    enabled: Boolean(currentFile),
    playbackState: playing ? "playing" : "paused",
    durationSec: duration > 0 ? duration : undefined,
    positionSec: current,
    playbackRate: rate,
    defaultSeekOffsetSec: 30,
    onPlay: () => {
      const audio = audioRef.current;
      if (audio) {
        void startPlayback(audio);
      }
    },
    onPause: () => {
      playIntentRef.current = false;
      audioRef.current?.pause();
      setPlaying(false);
    },
    onSeek: seekTo,
    onSeekBy: skip,
    onPreviousTrack: () => {
      if (fileIndexRef.current > 0) {
        playFile(fileIndexRef.current - 1, true);
      } else {
        seekTo(0);
      }
    },
    onNextTrack: () => {
      const next = nextChapterIndex(fileIndexRef.current, filesRef.current.length);
      if (next != null) {
        playFile(next, true);
      }
    },
  });

  if (!currentFile) {
    return <p className="px-4 text-zinc-400">No audio files in this pack.</p>;
  }

  const progressMax = duration > 0 ? duration : 1;
  const progressValue = Math.min(current, progressMax);
  const progressPercent = duration > 0 ? Math.min(100, (progressValue / duration) * 100) : 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="relative mx-auto flex min-h-0 w-full min-w-0 max-w-lg flex-1 flex-col overflow-y-auto px-6 py-6 md:max-w-xl md:py-8">
        {artworkUrl ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="aspect-[2/3] h-full max-h-[min(52vh,28rem)] w-auto max-w-full">
              <ProgressiveCoverImage
                src={artworkUrl}
                alt=""
                className="h-full w-full rounded-lg object-cover shadow-2xl"
              />
            </div>
          </div>
        ) : null}

        <div className="mt-5 w-full shrink-0 space-y-4">
          <div className="min-w-0 text-center md:text-left">
            <h1 className="truncate text-xl font-semibold text-white sm:text-2xl">{title}</h1>
            {artist ? <p className="mt-1 truncate text-zinc-300">{artist}</p> : null}
            {chapterLabel ? (
              <p className="mt-1 truncate text-sm text-zinc-500">{chapterLabel}</p>
            ) : null}
          </div>

          {playbackError ? (
            <div className="rounded-md border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
              <p className="font-medium">Playback error</p>
              <p className="mt-1 break-words text-red-100/90">{playbackError}</p>
            </div>
          ) : null}

          <audio
            ref={audioRef}
            src={currentFile.url}
            preload="metadata"
            playsInline
            onPlay={() => {
              playIntentRef.current = true;
              setPlaying(true);
              setPlaybackError(undefined);
            }}
            onPause={() => {
              if (!playIntentRef.current) {
                setPlaying(false);
              }
            }}
            onWaiting={() => setLoading(true)}
            onLoadStart={() => setLoading(true)}
            onCanPlay={() => setLoading(false)}
            onPlaying={() => setLoading(false)}
            onTimeUpdate={(event) => {
              const audio = event.currentTarget;
              const time = audio.currentTime;
              setCurrent(time);
              const known = audio.duration;
              if (
                !advancingRef.current &&
                Number.isFinite(known) &&
                known > 0 &&
                time >= known - 0.35
              ) {
                handleTrackEnded();
              }
            }}
            onLoadedMetadata={(event) => {
              const audio = event.currentTarget;
              const known = Number.isFinite(audio.duration) ? audio.duration : 0;
              setDuration(known);
              if (known > 0) {
                setDurations((prev) => ({ ...prev, [fileIndexRef.current]: known }));
              }
              setPlaybackError(undefined);
              setLoading(false);
              advancingRef.current = false;
              applyInitialSeek(audio, {
                fileIndex: fileIndexRef.current,
                initialFileIndex,
                initialPositionSec,
                seekAppliedRef,
              });
              if (!playIntentRef.current) {
                return;
              }
              void playMediaElement(audio).then((result) => {
                if (result.status === "error") {
                  setPlaybackError(`Could not start playback: ${result.error.message}`);
                  playIntentRef.current = false;
                  setPlaying(false);
                  return;
                }
                if (result.status === "playing") {
                  setPlaying(true);
                  setPlaybackError(undefined);
                }
              });
            }}
            onError={(event) => {
              if (isIgnorableAudioAbort(event.currentTarget.error?.code)) {
                return;
              }
              playIntentRef.current = false;
              setPlaying(false);
              setLoading(false);
              setPlaybackError(mapMediaElementError(event.currentTarget));
            }}
            onEnded={handleTrackEnded}
          />

          <div>
            <input
              type="range"
              min={0}
              max={progressMax}
              step={1}
              value={progressValue}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCurrent(next);
                if (audioRef.current) {
                  audioRef.current.currentTime = next;
                }
              }}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-red-600"
              style={{
                background: `linear-gradient(to right, #dc2626 0%, #dc2626 ${progressPercent}%, rgb(63 63 70) ${progressPercent}%, rgb(63 63 70) 100%)`,
              }}
              aria-label="Seek"
            />
            <div className="mt-1 flex justify-between text-xs text-zinc-500">
              <span>{formatAudiobookTime(current)}</span>
              <span>{formatAudiobookTime(duration)}</span>
            </div>
          </div>

          <div className="relative flex items-center justify-center gap-3 sm:gap-4">
            <button
              type="button"
              className="rounded-full p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-40"
              disabled={fileIndex <= 0}
              onClick={() => playFile(fileIndex - 1, true)}
              aria-label="Previous chapter"
            >
              <TrackPreviousIcon className="h-6 w-6" />
            </button>
            <button
              type="button"
              className="rounded-full border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-white"
              onClick={() => skip(-30)}
            >
              −30s
            </button>
            <button
              type="button"
              className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white text-black transition hover:bg-zinc-200 disabled:opacity-60"
              onClick={toggle}
              disabled={loading && !playing}
              aria-label={loading ? "Loading" : playing ? "Pause" : "Play"}
            >
              {loading && !playing ? (
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-400 border-t-black" />
              ) : playing ? (
                <PauseIcon className="h-7 w-7" />
              ) : (
                <PlayIcon className="h-7 w-7 translate-x-0.5" />
              )}
            </button>
            <button
              type="button"
              className="rounded-full border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-white"
              onClick={() => skip(30)}
            >
              +30s
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-40"
              disabled={fileIndex >= files.length - 1}
              onClick={() => playFile(fileIndex + 1, true)}
              aria-label="Next chapter"
            >
              <TrackNextIcon className="h-6 w-6" />
            </button>
            <ChaptersToggleButton
              open={chaptersOpen}
              count={files.length}
              onClick={() => setChaptersOpen((value) => !value)}
              className="absolute right-0 hidden sm:inline-flex"
            />
          </div>

          <div className="flex items-center justify-center gap-2 sm:hidden">
            <ChaptersToggleButton
              open={chaptersOpen}
              count={files.length}
              onClick={() => setChaptersOpen((value) => !value)}
            />
          </div>

          {loading && playing ? (
            <p className="text-center text-xs text-zinc-500">Buffering…</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm text-zinc-500">Speed</span>
            {[0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs",
                  rate === value
                    ? "bg-red-600 text-white"
                    : "border border-zinc-700 text-zinc-300 hover:border-zinc-500",
                )}
                onClick={() => setRate(value)}
              >
                {value}x
              </button>
            ))}
          </div>
        </div>
      </div>

      <ChapterQueuePanel
        files={files}
        fileIndex={fileIndex}
        packKind={packKind}
        durations={durations}
        open={chaptersOpen}
        onOpenChange={setChaptersOpen}
        onSelect={(index) => playFile(index, true)}
      />
    </div>
  );
}
