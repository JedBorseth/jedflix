// Copyright (C) 2017-2023 Smart code 203358507
// Adapted for JedFlix

import { toDisplaySeconds, toPlayerTimeMs } from "./time";

type ControlBarProps = {
  paused: boolean;
  time: number;
  duration: number;
  onPlayRequested: () => void;
  onPauseRequested: () => void;
  onSeekRequested: (timeMs: number) => void;
  onSkipBackward: () => void;
  onSkipForward: () => void;
};

function formatTime(totalSeconds: number): string {
  const safeSeconds = Math.floor(Math.max(0, totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const paddedMinutes = minutes.toString().padStart(2, "0");
  const paddedSeconds = seconds.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

function PlayIcon() {
  return (
    <svg className="player-control-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72c0 .79.87 1.27 1.54.84l11.14-6.86c.63-.39.63-1.29 0-1.68L9.54 4.3C8.87 3.87 8 4.35 8 5.14z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="player-control-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

export function ControlBar({
  paused,
  time,
  duration,
  onPlayRequested,
  onPauseRequested,
  onSeekRequested,
  onSkipBackward,
  onSkipForward,
}: ControlBarProps) {
  const displayTime = toDisplaySeconds(time);
  const displayDuration = toDisplaySeconds(duration);
  const maxSeek = Math.max(displayDuration, 0);

  return (
    <div
      className="player-control-bar"
      onMouseMove={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="player-controls-row">
        <button
          type="button"
          className="player-icon-button"
          aria-label="Skip back 15 seconds"
          onClick={onSkipBackward}
        >
          -15
        </button>
        <button
          type="button"
          className="player-icon-button player-icon-button-primary"
          aria-label={paused ? "Play" : "Pause"}
          onClick={paused ? onPlayRequested : onPauseRequested}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button
          type="button"
          className="player-icon-button"
          aria-label="Skip forward 15 seconds"
          onClick={onSkipForward}
        >
          +15
        </button>
        <input
          type="range"
          min={0}
          max={maxSeek}
          step={1}
          value={Math.min(displayTime, maxSeek)}
          aria-label="Seek"
          className="player-seek-bar"
          onChange={(event) => {
            const nextSeconds = Number(event.target.value);
            onSeekRequested(toPlayerTimeMs(nextSeconds));
          }}
        />
        <div className="player-time">
          {formatTime(displayTime)} / {formatTime(displayDuration)}
        </div>
      </div>
    </div>
  );
}
