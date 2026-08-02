// Copyright (C) 2017-2023 Smart code 203358507
// Adapted for JedFlix

import { useState } from "react";
import { toDisplaySeconds, toPlayerTimeMs } from "./time";

type ControlBarProps = {
  paused: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  onPlayRequested: () => void;
  onPauseRequested: () => void;
  onSeekRequested: (timeMs: number) => void;
  onSkipBackward: () => void;
  onSkipForward: () => void;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
  nextEpisode?: { label: string; onClick: () => void } | null;
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

function VolumeHighIcon() {
  return (
    <svg className="player-control-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 10v4h3.5L12 19V5L6.5 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 4.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

function VolumeLowIcon() {
  return (
    <svg className="player-control-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 10v4h3.5L12 19V5L6.5 10H3zm10.5 2c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
    </svg>
  );
}

function VolumeMutedIcon() {
  return (
    <svg className="player-control-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v4h3.5L12 19v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
    </svg>
  );
}

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) {
    return <VolumeMutedIcon />;
  }
  if (volume < 0.5) {
    return <VolumeLowIcon />;
  }
  return <VolumeHighIcon />;
}

export function ControlBar({
  paused,
  time,
  duration,
  volume,
  muted,
  onPlayRequested,
  onPauseRequested,
  onSeekRequested,
  onSkipBackward,
  onSkipForward,
  onVolumeChange,
  onMuteToggle,
  nextEpisode = null,
}: ControlBarProps) {
  const [volumePinned, setVolumePinned] = useState(false);
  const displayTime = toDisplaySeconds(time);
  const displayDuration = toDisplaySeconds(duration);
  const maxSeek = Math.max(displayDuration, 0);
  const seekPercent = maxSeek > 0 ? Math.min(100, (Math.min(displayTime, maxSeek) / maxSeek) * 100) : 0;
  const displayVolume = muted ? 0 : volume;
  const volumePercent = Math.round(displayVolume * 100);

  return (
    <div
      className="player-control-bar"
      onMouseMove={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {nextEpisode ? (
        <div className="player-next-episode-row">
          <button
            type="button"
            className="player-next-episode-button"
            onClick={nextEpisode.onClick}
          >
            {nextEpisode.label}
          </button>
        </div>
      ) : null}
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
        <div
          className={`player-volume ${volumePinned ? "player-volume-pinned" : ""}`}
          onMouseLeave={() => setVolumePinned(false)}
        >
          <button
            type="button"
            className="player-icon-button"
            aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
            aria-expanded={volumePinned}
            onClick={() => {
              onMuteToggle();
              setVolumePinned(true);
            }}
          >
            <VolumeIcon volume={volume} muted={muted} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={displayVolume}
            aria-label="Volume"
            className="player-volume-slider"
            style={{
              background: `linear-gradient(to right, #fff 0%, #fff ${volumePercent}%, rgba(255, 255, 255, 0.25) ${volumePercent}%, rgba(255, 255, 255, 0.25) 100%)`,
            }}
            onChange={(event) => {
              onVolumeChange(Number(event.target.value));
              setVolumePinned(true);
            }}
            onPointerDown={() => setVolumePinned(true)}
          />
        </div>
        <input
          type="range"
          min={0}
          max={maxSeek}
          step={1}
          value={Math.min(displayTime, maxSeek)}
          aria-label="Seek"
          className="player-seek-bar"
          style={{
            background: `linear-gradient(to right, #e50914 0%, #e50914 ${seekPercent}%, rgba(255, 255, 255, 0.25) ${seekPercent}%, rgba(255, 255, 255, 0.25) 100%)`,
          }}
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
