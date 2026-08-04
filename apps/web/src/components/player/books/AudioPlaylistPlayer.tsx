import { useEffect, useRef, useState } from "react";
import { useMediaSession } from "@/hooks/useMediaSession";
import { mapMediaElementError } from "@/components/player/shared/playbackErrors";
import { playMediaElement } from "@/lib/mediaSession";
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
  const [current, setCurrent] = useState(initialPositionSec);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [playbackError, setPlaybackError] = useState<string>();
  const seekAppliedRef = useRef(false);
  const playIntentRef = useRef(false);

  const currentFile = files[fileIndex];
  const chapterLabel =
    files.length > 1
      ? `${fileIndex + 1}. ${currentFile?.filename ?? "Chapter"}`
      : currentFile?.filename;

  useEffect(() => {
    seekAppliedRef.current = false;
    setCurrent(fileIndex === initialFileIndex ? initialPositionSec : 0);
    setPlaybackError(undefined);
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
        fileIndex,
        positionSec: Math.floor(audio.currentTime),
      });
    }, 15000);
    return () => window.clearInterval(interval);
  }, [fileIndex, onProgress]);

  async function startPlayback(audio: HTMLAudioElement) {
    playIntentRef.current = true;
    setPlaying(true);
    applyInitialSeek(audio, {
      fileIndex,
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
    // Aborted by a newer load/seek — keep intent; metadata handler may retry.
    setPlaying(!audio.paused);
  }

  function playFile(index: number, autoplay: boolean) {
    playIntentRef.current = autoplay;
    setFileIndex(index);
    setPlaying(autoplay);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) {
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
      if (fileIndex > 0) {
        playFile(fileIndex - 1, true);
      } else {
        seekTo(0);
      }
    },
    onNextTrack: () => {
      if (fileIndex < files.length - 1) {
        playFile(fileIndex + 1, true);
      }
    },
  });

  if (!currentFile) {
    return <p className="text-zinc-400">No audio files in this pack.</p>;
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 md:p-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            {packLabel(packKind, files.length)}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white">{title}</h1>
          {artist ? <p className="mt-1 text-sm text-zinc-300">{artist}</p> : null}
          <p className="mt-1 text-sm text-zinc-400">{currentFile.filename}</p>
          {currentFile.mimeType ? (
            <p className="mt-1 text-xs text-zinc-600">{currentFile.mimeType}</p>
          ) : null}
        </div>

        {playbackError ? (
          <div className="rounded-md border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-200">
            <p className="font-medium">Playback error</p>
            <p className="mt-1 break-words text-red-100/90">{playbackError}</p>
            <p className="mt-2 text-xs text-red-200/70">
              File: {currentFile.filename}
              {currentFile.url ? ` · ${currentFile.url.slice(0, 64)}…` : null}
            </p>
          </div>
        ) : null}

        <audio
          ref={audioRef}
          key={currentFile.url}
          preload="metadata"
          playsInline
          onPlay={() => {
            playIntentRef.current = true;
            setPlaying(true);
            setPlaybackError(undefined);
          }}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const audio = event.currentTarget;
            setDuration(audio.duration);
            setPlaybackError(undefined);
            // Seek before any follow-up play() so we don't abort an in-flight play
            // from the user's Play click (that race surfaced as "operation was aborted").
            applyInitialSeek(audio, {
              fileIndex,
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
            playIntentRef.current = false;
            setPlaying(false);
            setPlaybackError(mapMediaElementError(event.currentTarget));
          }}
          onEnded={() => {
            onProgress?.({ fileIndex, positionSec: Math.floor(duration || current) });
            if (fileIndex < files.length - 1) {
              playFile(fileIndex + 1, true);
            } else {
              playIntentRef.current = false;
              setPlaying(false);
            }
          }}
        >
          <source src={currentFile.url} type={currentFile.mimeType || undefined} />
        </audio>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            disabled={fileIndex <= 0}
            onClick={() => playFile(fileIndex - 1, true)}
          >
            Prev
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-white"
            onClick={() => skip(-30)}
          >
            -30s
          </button>
          <button
            type="button"
            className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-black"
            onClick={toggle}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-white"
            onClick={() => skip(30)}
          >
            +30s
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-white disabled:opacity-40"
            disabled={fileIndex >= files.length - 1}
            onClick={() => playFile(fileIndex + 1, true)}
          >
            Next
          </button>
        </div>

        <div>
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

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-400">Speed</span>
          {[0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => (
            <button
              key={value}
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs ${
                rate === value
                  ? "bg-red-600 text-white"
                  : "border border-zinc-700 text-zinc-300"
              }`}
              onClick={() => setRate(value)}
            >
              {value}x
            </button>
          ))}
        </div>
      </div>

      {files.length > 1 ? (
        <aside className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
          <h2 className="mb-2 text-sm font-semibold text-white">
            {packKind === "series" ? "Books" : "Chapters"}
          </h2>
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {files.map((file) => (
              <li key={`${file.fileId}-${file.index}`}>
                <button
                  type="button"
                  onClick={() => playFile(file.index, true)}
                  className={`w-full rounded-md px-2 py-2 text-left text-xs ${
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
