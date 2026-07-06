// Copyright (C) 2017-2023 Smart code 203358507
// Adapted for JedFlix

import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useScreenOrientationLock } from "@/hooks/useScreenOrientationLock";
import { fetchSources, type StreamMode, type StreamSource } from "@/lib/streamApi";
import { buildDirectStreamHints } from "@/lib/streamPlayback";
import type { MediaType } from "@/lib/types";
import { ControlBar } from "./ControlBar";
import { toDisplaySeconds } from "./time";
import { StreamSourcePicker } from "./StreamSourcePicker";
import { useStreamResolve } from "./useStreamResolve";
import { useVideo } from "./useVideo";
import "./player.css";

type StremioPlayerProps = {
  movieId: number;
  mediaType: MediaType;
  title: string;
  imdbId: string;
  season?: number;
  episode?: number;
  mode: StreamMode;
  realDebridApiKey?: string;
  initialProgressSeconds?: number;
  backPath: string;
};

type DebouncedSaveProgress = ((progressSeconds: number) => void) & { cancel: () => void };

export function StremioPlayer({
  movieId,
  mediaType,
  title,
  imdbId,
  season,
  episode,
  mode,
  realDebridApiKey = "",
  initialProgressSeconds = 0,
  backPath,
}: StremioPlayerProps) {
  const { containerRef, state, load, unload, setPaused, setTime, events } = useVideo();
  const [controlsHidden, setControlsHidden] = useState(false);
  const hideControlsTimeoutRef = useRef<number | null>(null);
  const [sources, setSources] = useState<StreamSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<StreamSource | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(true);
  const [fallbackProgress, setFallbackProgress] = useState<string | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const upsertProgress = useMutation(api.watchHistory.upsertProgress);
  const saveProgressRef = useRef<DebouncedSaveProgress | null>(null);
  if (saveProgressRef.current === null) {
    saveProgressRef.current = debounce((progressSeconds: number) => {
      void upsertProgress({
        movieId,
        mediaType,
        progressSeconds,
        season,
        episode,
      }).catch(() => {
        // Guests cannot save progress.
      });
    }, 10000) as DebouncedSaveProgress;
  }

  const baseRequest = useMemo(
    () => ({
      type: mediaType === "tv" ? ("tv" as const) : ("movie" as const),
      imdbId,
      season,
      episode,
    }),
    [episode, imdbId, mediaType, season],
  );

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    setSelectedSource(null);
    setFallbackProgress(null);
    loadedUrlRef.current = null;
    setShowSourcePicker(true);
    try {
      const found = await fetchSources(baseRequest, realDebridApiKey.trim() || undefined);
      setSources(found);
    } catch (error) {
      setSources([]);
      setSourcesError(error instanceof Error ? error.message : "Failed to load streams");
    } finally {
      setSourcesLoading(false);
    }
  }, [baseRequest, realDebridApiKey]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const resolveRequest = useMemo(
    () =>
      selectedSource
        ? {
            ...baseRequest,
            mode,
            magnet: selectedSource.magnet,
            infoHash: selectedSource.infoHash,
            realDebridToken: realDebridApiKey.trim() || undefined,
          }
        : null,
    [baseRequest, mode, realDebridApiKey, selectedSource],
  );

  const resolveState = useStreamResolve(resolveRequest, selectedSource);
  const resolving = resolveState.status === "downloading";

  useEffect(() => {
    const playbackUrl = resolveState.playbackUrl;
    if (!playbackUrl || loadedUrlRef.current === playbackUrl) {
      return;
    }

    const filename = resolveState.stream?.filename ?? title;

    load({
      stream: {
        url: playbackUrl,
        name: filename,
        behaviorHints: buildDirectStreamHints(filename),
      },
      autoplay: true,
      time: initialProgressSeconds * 1000,
    });
    loadedUrlRef.current = playbackUrl;
  }, [
    initialProgressSeconds,
    load,
    resolveState.playbackUrl,
    resolveState.stream?.filename,
    title,
  ]);

  useEffect(() => {
    const onEnded = () => setPaused(true);
    events.on("ended", onEnded);
    return () => {
      events.off("ended", onEnded);
    };
  }, [events, setPaused]);

  useEffect(() => {
    const time = state.time;
    if (typeof time === "number" && toDisplaySeconds(time) > 0) {
      saveProgressRef.current?.(toDisplaySeconds(time));
    }
  }, [state.time]);

  useEffect(() => {
    const saveProgress = saveProgressRef.current;
    return () => {
      saveProgress?.cancel();
      unload();
    };
  }, [unload]);

  const CONTROLS_HIDE_DELAY_MS = 8000;

  const scheduleHideControls = useCallback(() => {
    if (hideControlsTimeoutRef.current !== null) {
      window.clearTimeout(hideControlsTimeoutRef.current);
    }
    hideControlsTimeoutRef.current = window.setTimeout(() => {
      setControlsHidden(true);
      hideControlsTimeoutRef.current = null;
    }, CONTROLS_HIDE_DELAY_MS);
  }, []);

  const showControls = useCallback(() => {
    setControlsHidden(false);
    scheduleHideControls();
  }, [scheduleHideControls]);

  useEffect(() => {
    return () => {
      if (hideControlsTimeoutRef.current !== null) {
        window.clearTimeout(hideControlsTimeoutRef.current);
      }
    };
  }, []);

  const paused = state.paused ?? false;
  const time = state.time ?? 0;
  const duration = state.duration ?? 0;
  const buffering = Boolean(state.buffering) || resolving;
  const failed = resolveState.status === "failed";
  const forceControlsVisible = paused || showSourcePicker || buffering || failed;
  const hideOverlay = controlsHidden && !forceControlsVisible;
  const isPlaying = !forceControlsVisible && loadedUrlRef.current !== null;

  useScreenOrientationLock(isPlaying);

  const handleSelectSource = useCallback(
    (source: StreamSource) => {
      if (sourcesLoading || resolving) {
        return;
      }
      if (selectedSource?.id === source.id) {
        return;
      }
      setFallbackProgress(null);
      setSelectedSource(source);
      setShowSourcePicker(false);
      scheduleHideControls();
    },
    [resolving, scheduleHideControls, selectedSource?.id, sourcesLoading],
  );

  useEffect(() => {
    if (resolveState.status !== "failed" || !selectedSource || !isFallbackError(resolveState.errorCode)) {
      return;
    }

    const currentIndex = sources.findIndex((source) => source.id === selectedSource.id);
    if (currentIndex < 0) {
      return;
    }
    const nextSource = sources[currentIndex + 1];
    if (!nextSource) {
      return;
    }

    setFallbackProgress(`Trying stream ${currentIndex + 2} of ${sources.length}`);
    loadedUrlRef.current = null;
    setSelectedSource(nextSource);
  }, [resolveState.errorCode, resolveState.status, selectedSource, sources]);

  const onActivity = useCallback(() => {
    if (showSourcePicker || buffering || failed) {
      return;
    }
    showControls();
  }, [buffering, failed, showControls, showSourcePicker]);

  const togglePlayPause = useCallback(() => {
    if (showSourcePicker || buffering || failed) {
      return;
    }
    showControls();
    setPaused(!paused);
  }, [buffering, failed, paused, setPaused, showControls, showSourcePicker]);

  const handleVideoLayerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      togglePlayPause();
    },
    [togglePlayPause],
  );

  const skipBy = useCallback(
    (deltaMs: number) => {
      const max = duration > 0 ? duration : time;
      setTime(Math.max(0, Math.min(time + deltaMs, max)));
      showControls();
    },
    [duration, setTime, showControls, time],
  );

  return (
    <div
      className={`player-container ${hideOverlay ? "overlay-hidden" : ""}`}
      onMouseMove={onActivity}
      onTouchMove={onActivity}
      onTouchStart={onActivity}
    >
      <button
        type="button"
        className="player-video-layer"
        aria-label={paused ? "Play video" : "Pause video"}
        onClick={togglePlayPause}
        onKeyDown={handleVideoLayerKeyDown}
      >
        <div ref={containerRef} className="player-video-container" />
      </button>

      {showSourcePicker ? (
        <StreamSourcePicker
          sources={sources}
          loading={sourcesLoading}
          error={sourcesError ?? undefined}
          disabled={sourcesLoading || resolving}
          selectedId={selectedSource?.id}
          onSelect={handleSelectSource}
          onRetry={() => {
            void loadSources();
          }}
        />
      ) : null}

      {buffering ? (
        <div className="player-buffering">
          <div className="player-spinner" />
          <p>{fallbackProgress ?? resolveState.progress ?? "Buffering..."}</p>
          {resolving && selectedSource ? (
            <p className="max-w-md px-4 text-center text-sm text-zinc-400">
              Resolving {selectedSource.title}
            </p>
          ) : null}
        </div>
      ) : null}

      {failed ? (
        <div className="player-error">
          <h2 className="text-xl font-semibold">Unable to play stream</h2>
          <p className="text-zinc-300">{resolveState.error ?? "Stream resolve failed."}</p>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-md bg-white px-4 py-2 text-black"
              onClick={() => {
                setSelectedSource(null);
                setFallbackProgress(null);
                loadedUrlRef.current = null;
                setShowSourcePicker(true);
              }}
            >
              Pick another stream
            </button>
            <Link to={backPath} className="rounded-md border border-zinc-600 px-4 py-2 text-white">
              Back
            </Link>
          </div>
        </div>
      ) : null}

      <div className="player-overlay">
        <div className="player-top-bar">
          <div className="player-top-bar-left">
            <Link to={backPath} className="player-icon-button" aria-label="Back">
              ←
            </Link>
            <div>
              <div className="player-title">{title}</div>
              {mediaType === "tv" && season && episode ? (
                <div className="text-xs text-zinc-400">
                  Season {season} · Episode {episode}
                </div>
              ) : null}
            </div>
          </div>
          <div className="player-top-bar-right">
            {!showSourcePicker ? (
              <button
                type="button"
                className="player-mode-badge"
                onClick={() => setShowSourcePicker(true)}
              >
                Change stream
              </button>
            ) : null}
            <span className="player-mode-badge">{mode}</span>
          </div>
        </div>

        {!failed && !buffering && !showSourcePicker ? (
          <ControlBar
            paused={paused}
            time={time}
            duration={duration}
            onPlayRequested={() => setPaused(false)}
            onPauseRequested={() => setPaused(true)}
            onSeekRequested={(nextTime) => setTime(nextTime)}
            onSkipBackward={() => skipBy(-15_000)}
            onSkipForward={() => skipBy(15_000)}
          />
        ) : null}
      </div>
    </div>
  );
}

function isFallbackError(errorCode?: string): boolean {
  return (
    errorCode === "infringing_file" ||
    errorCode === "timeout" ||
    errorCode === "no_video_file" ||
    errorCode === "size_limit" ||
    errorCode === "no_links"
  );
}
