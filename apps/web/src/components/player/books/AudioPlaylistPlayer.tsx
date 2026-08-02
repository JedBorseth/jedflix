import { useEffect, useRef, useState } from "react";
import { mapMediaElementError } from "@/components/player/shared/playbackErrors";
import type { PackKind, StreamFile } from "@/lib/streamApi";

type AudioPlaylistPlayerProps = {
  title: string;
  files: StreamFile[];
  packKind?: PackKind;
  initialFileIndex?: number;
  initialPositionSec?: number;
  onProgress?: (progress: { fileIndex: number; positionSec: number }) => void;
};

function formatTime(sec: number) {
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

function packLabel(packKind: PackKind | undefined, count: number) {
  if (count <= 1) {
    return "Single file";
  }
  if (packKind === "series") {
    return `${count} books in series`;
  }
  if (packKind === "chapters") {
    return `${count} chapters`;
  }
  return `${count} files`;
}

export function AudioPlaylistPlayer({
  title,
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
  const [current, setCurrent] = useState(initialPositionSec);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [playbackError, setPlaybackError] = useState<string>();
  const seekAppliedRef = useRef(false);

  const currentFile = files[fileIndex];

  useEffect(() => {
    seekAppliedRef.current = false;
    setCurrent(fileIndex === initialFileIndex ? initialPositionSec : 0);
    setDuration(0);
    setPlaybackError(undefined);
  }, [fileIndex, initialFileIndex, initialPositionSec, currentFile?.url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentFile?.url) {
      return;
    }
    // Set src on the element itself — nested <source> is less reliable in Safari for RD URLs.
    audio.src = currentFile.url;
    audio.load();
  }, [currentFile?.url]);

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
        fileIndex,
        positionSec: Math.floor(audio.currentTime),
      });
    }, 15000);
    return () => window.clearInterval(interval);
  }, [fileIndex, onProgress]);

  function playFile(index: number, autoplay: boolean) {
    setFileIndex(index);
    setPlaying(autoplay);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch((error: unknown) => {
        setPlaybackError(
          error instanceof Error
            ? `Could not start playback: ${error.message}`
            : mapMediaElementError(audio),
        );
        setPlaying(false);
      });
      setPlaying(true);
    } else {
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
  }

  if (!currentFile) {
    return <p className="text-zinc-400">No audio files in this pack.</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6">
      <div className="w-full rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.35)] md:p-10">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
          {packLabel(packKind, files.length)}
        </p>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white md:text-4xl">
          {title}
        </h1>
        <p className="mt-2 truncate text-sm text-zinc-400">{currentFile.filename}</p>

        {playbackError ? (
          <div className="mt-5 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-left text-sm text-red-200">
            <p className="font-medium">Playback error</p>
            <p className="mt-1 break-words text-red-100/90">{playbackError}</p>
            <a
              href={currentFile.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-xs text-red-300 underline"
            >
              Open / download this file directly
            </a>
          </div>
        ) : null}

        <audio
          ref={audioRef}
          preload="metadata"
          playsInline
          controls={false}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration);
            setPlaybackError(undefined);
            if (!seekAppliedRef.current && fileIndex === initialFileIndex && initialPositionSec > 0) {
              event.currentTarget.currentTime = initialPositionSec;
              seekAppliedRef.current = true;
            }
            if (playing) {
              void event.currentTarget.play().catch((error: unknown) => {
                setPlaybackError(
                  error instanceof Error
                    ? `Could not start playback: ${error.message}`
                    : mapMediaElementError(event.currentTarget),
                );
                setPlaying(false);
              });
            }
          }}
          onError={(event) => {
            setPlaying(false);
            setPlaybackError(mapMediaElementError(event.currentTarget));
          }}
          onEnded={() => {
            onProgress?.({ fileIndex, positionSec: Math.floor(duration || current) });
            if (fileIndex < files.length - 1) {
              playFile(fileIndex + 1, true);
            } else {
              setPlaying(false);
            }
          }}
        />

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            className="rounded-full border border-zinc-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            disabled={fileIndex <= 0}
            onClick={() => playFile(fileIndex - 1, true)}
            aria-label="Previous file"
          >
            Prev
          </button>
          <button
            type="button"
            className="rounded-full border border-zinc-700 px-3 py-2 text-sm text-white"
            onClick={() => skip(-30)}
          >
            −30s
          </button>
          <button
            type="button"
            className="rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-black shadow-lg shadow-black/30 transition hover:bg-zinc-100"
            onClick={toggle}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="rounded-full border border-zinc-700 px-3 py-2 text-sm text-white"
            onClick={() => skip(30)}
          >
            +30s
          </button>
          <button
            type="button"
            className="rounded-full border border-zinc-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            disabled={fileIndex >= files.length - 1}
            onClick={() => playFile(fileIndex + 1, true)}
            aria-label="Next file"
          >
            Next
          </button>
        </div>

        <div className="mx-auto mt-6 max-w-xl">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={1}
            value={Math.min(current, duration || 1)}
            onChange={(event) => {
              const next = Number(event.target.value);
              setCurrent(next);
              if (audioRef.current) {
                audioRef.current.currentTime = next;
              }
            }}
            className="w-full accent-red-600"
          />
          <div className="mt-1 flex justify-between text-xs text-zinc-500">
            <span>{formatTime(current)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="text-sm text-zinc-500">Speed</span>
          {[0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
            <button
              key={value}
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs ${
                rate === value
                  ? "bg-red-600 text-white"
                  : "border border-zinc-700 text-zinc-300 hover:border-zinc-500"
              }`}
              onClick={() => setRate(value)}
            >
              {value}x
            </button>
          ))}
        </div>

        <a
          href={currentFile.url}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-block text-xs text-zinc-600 underline hover:text-zinc-400"
        >
          Open file URL
        </a>
      </div>

      {files.length > 1 ? (
        <aside className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <h2 className="mb-3 text-center text-sm font-semibold text-white">
            {packKind === "series" ? "Books" : "Chapters"}
          </h2>
          <ul className="mx-auto max-h-[40vh] max-w-xl space-y-1 overflow-y-auto">
            {files.map((file) => (
              <li key={`${file.fileId}-${file.index}`}>
                <button
                  type="button"
                  onClick={() => playFile(file.index, true)}
                  className={`w-full rounded-md px-3 py-2 text-left text-xs ${
                    file.index === fileIndex
                      ? "bg-red-950/50 text-white"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  }`}
                >
                  <span className="mr-2 text-zinc-600">{file.index + 1}.</span>
                  {file.filename}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
