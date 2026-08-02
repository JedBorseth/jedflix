import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@convex/_generated/api";
import { useMediaSession } from "@/hooks/useMediaSession";
import { useScreenOrientationLock } from "@/hooks/useScreenOrientationLock";
import { formatWatchSessionTitle } from "@/lib/mediaSession";
import { catalogQueryKeys } from "@/lib/queryClient";
import { fetchSources, type StreamSource } from "@/lib/streamApi";
import { prepareBrowserSources } from "@/lib/iosPlayback";
import { getTvSeasons, getWatchPath } from "@/lib/tmdb";
import type { MediaType } from "@/lib/types";
import { PlayerErrorOverlay } from "../shared/PlayerErrorOverlay";
import { ExternalPlayerMenu } from "../shared/ExternalPlayerMenu";
import { isFallbackError, MAX_AUTO_FALLBACKS } from "../shared/playbackErrors";
import { ResolveProgressHint } from "../shared/ResolveProgressHint";
import {
  isInNextEpisodeWindow,
  resolveNextEpisode,
} from "../shared/resolveNextEpisode";
import { ControlBar } from "../stremio/ControlBar";
import { toDisplaySeconds } from "../stremio/time";
import { StreamSourcePicker } from "../stremio/StreamSourcePicker";
import { useStreamResolve } from "../stremio/useStreamResolve";
import { useVideoJs } from "./useVideoJs";
import "../stremio/player.css";

type VideoJsPlayerProps = {
  movieId: number;
  mediaType: MediaType;
  title: string;
  artworkUrl?: string | null;
  imdbId: string;
  season?: number;
  episode?: number;
  realDebridApiKey?: string;
  initialProgressSeconds?: number;
  backPath: string;
};

type DebouncedSaveProgress = ((progressSeconds: number) => void) & { cancel: () => void };

export function VideoJsPlayer({
  movieId,
  mediaType,
  title,
  artworkUrl,
  imdbId,
  season,
  episode,
  realDebridApiKey = "",
  initialProgressSeconds = 0,
  backPath,
}: VideoJsPlayerProps) {
  const navigate = useNavigate();
  const { containerRef, state, load, unload, setPaused, setTime, setVolume, setMuted, events } =
    useVideoJs();
  const [controlsHidden, setControlsHidden] = useState(false);
  const hideControlsTimeoutRef = useRef<number | null>(null);
  const [sources, setSources] = useState<StreamSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [skipCompatFilters, setSkipCompatFilters] = useState(false);
  const [selectedSource, setSelectedSource] = useState<StreamSource | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(true);
  const [fallbackProgress, setFallbackProgress] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const fallbackAttemptsRef = useRef(0);
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

  const seasonsQuery = useQuery({
    queryKey: catalogQueryKeys.tmdb.seasons(movieId),
    queryFn: () => getTvSeasons(movieId),
    enabled: mediaType === "tv" && Number.isFinite(movieId),
  });

  const nextEpisode = useMemo(() => {
    if (mediaType !== "tv" || season == null || episode == null || !seasonsQuery.data) {
      return null;
    }
    return resolveNextEpisode(seasonsQuery.data, season, episode);
  }, [episode, mediaType, season, seasonsQuery.data]);

  const showNextEpisode =
    nextEpisode !== null && isInNextEpisodeWindow(state.time ?? 0, state.duration ?? 0);

  const baseRequest = useMemo(
    () => ({
      type: mediaType === "tv" ? ("tv" as const) : ("movie" as const),
      imdbId,
      season,
      episode,
      mediaTitle: title,
    }),
    [episode, imdbId, mediaType, season, title],
  );

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    setSelectedSource(null);
    setFallbackProgress(null);
    setPlaybackError(null);
    fallbackAttemptsRef.current = 0;
    loadedUrlRef.current = null;
    setShowSourcePicker(true);
    try {
      const found = await fetchSources(
        {
          ...baseRequest,
          playbackProfile: skipCompatFilters ? "external" : "browser",
        },
        realDebridApiKey.trim() || undefined,
      );
      setSources(prepareBrowserSources(found, { skipCompatFilter: skipCompatFilters }));
    } catch (error) {
      setSources([]);
      setSourcesError(error instanceof Error ? error.message : "Failed to load streams");
    } finally {
      setSourcesLoading(false);
    }
  }, [baseRequest, realDebridApiKey, skipCompatFilters]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const resolveRequest = useMemo(
    () =>
      selectedSource
        ? {
            ...baseRequest,
            magnet: selectedSource.magnet,
            infoHash: selectedSource.infoHash,
            fileIdx: selectedSource.fileIdx,
            realDebridToken: realDebridApiKey.trim() || undefined,
          }
        : null,
    [baseRequest, realDebridApiKey, selectedSource],
  );

  const resolveState = useStreamResolve(resolveRequest, selectedSource);
  const resolving = resolveState.status === "downloading";

  useEffect(() => {
    const playbackUrl = resolveState.playbackUrl;
    if (!playbackUrl || loadedUrlRef.current === playbackUrl) {
      return;
    }

    const filename = resolveState.stream?.filename ?? title;
    setPlaybackError(null);

    load({
      url: playbackUrl,
      filename,
      autoplay: true,
      startTimeSeconds: initialProgressSeconds,
    });
    loadedUrlRef.current = playbackUrl;
  }, [
    initialProgressSeconds,
    load,
    resolveState.playbackUrl,
    resolveState.stream?.filename,
    title,
  ]);

  const tryNextSource = useCallback(
    (message: string) => {
      if (!selectedSource) {
        setPlaybackError(message);
        return;
      }

      if (fallbackAttemptsRef.current >= MAX_AUTO_FALLBACKS) {
        setPlaybackError(
          `${message} Stopped after ${MAX_AUTO_FALLBACKS + 1} attempts to avoid Real Debrid rate limits.`,
        );
        return;
      }

      const currentIndex = sources.findIndex((source) => source.id === selectedSource.id);
      const nextSource = sources[currentIndex + 1];
      if (nextSource) {
        fallbackAttemptsRef.current += 1;
        setFallbackProgress(`Trying stream ${currentIndex + 2} of ${sources.length}`);
        loadedUrlRef.current = null;
        setPlaybackError(null);
        setSelectedSource(nextSource);
        return;
      }

      setPlaybackError(message);
    },
    [selectedSource, sources],
  );

  useEffect(() => {
    const onEnded = () => setPaused(true);
    const onError = (message: unknown) => {
      tryNextSource(typeof message === "string" ? message : "Playback failed.");
    };

    events.on("ended", onEnded);
    events.on("error", onError);
    return () => {
      events.off("ended", onEnded);
      events.off("error", onError);
    };
  }, [events, setPaused, tryNextSource]);

  useEffect(() => {
    if (resolveState.status !== "failed" || !selectedSource) {
      return;
    }
    if (resolveState.errorCode === "rate_limited") {
      setPlaybackError(resolveState.error ?? "Real Debrid rate limit reached.");
      return;
    }
    if (!isFallbackError(resolveState.errorCode)) {
      return;
    }
    if (fallbackAttemptsRef.current >= MAX_AUTO_FALLBACKS) {
      setPlaybackError(
        `${resolveState.error ?? "Stream resolve failed."} Stopped after ${MAX_AUTO_FALLBACKS + 1} attempts to avoid Real Debrid rate limits.`,
      );
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

    fallbackAttemptsRef.current += 1;
    setFallbackProgress(`Trying stream ${currentIndex + 2} of ${sources.length}`);
    loadedUrlRef.current = null;
    setSelectedSource(nextSource);
  }, [resolveState.error, resolveState.errorCode, resolveState.status, selectedSource, sources]);

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
  const volume = state.volume;
  const muted = state.muted;
  const buffering = Boolean(state.buffering) || resolving;
  const resolveFailed = resolveState.status === "failed";
  const failed = resolveFailed || playbackError !== null;
  const forceControlsVisible = paused || showSourcePicker || buffering || failed || showNextEpisode;
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
      fallbackAttemptsRef.current = 0;
      setFallbackProgress(null);
      setPlaybackError(null);
      setSelectedSource(source);
      setShowSourcePicker(false);
      scheduleHideControls();
    },
    [resolving, scheduleHideControls, selectedSource?.id, sourcesLoading],
  );

  const resetToSourcePicker = useCallback(() => {
    setSelectedSource(null);
    setFallbackProgress(null);
    setPlaybackError(null);
    fallbackAttemptsRef.current = 0;
    loadedUrlRef.current = null;
    setShowSourcePicker(true);
  }, []);

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
    (event: KeyboardEvent<HTMLDivElement>) => {
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

  const handleMuteToggle = useCallback(() => {
    if (muted) {
      setMuted(false);
      if (volume === 0) {
        setVolume(1);
      }
      return;
    }
    setMuted(true);
  }, [muted, setMuted, setVolume, volume]);

  const goToNextEpisode = useCallback(() => {
    if (!nextEpisode) {
      return;
    }
    navigate(getWatchPath("tv", movieId, nextEpisode.season, nextEpisode.episode));
  }, [movieId, navigate, nextEpisode]);

  const sessionTitle = formatWatchSessionTitle(
    title,
    mediaType === "tv" ? "tv" : "movie",
    season,
    episode,
  );
  const hasActiveStream = loadedUrlRef.current !== null && !showSourcePicker;

  useMediaSession({
    title: sessionTitle,
    artist: mediaType === "tv" ? title : "Movie",
    album: mediaType === "tv" && season != null ? `Season ${season}` : title,
    artworkUrl,
    enabled: hasActiveStream,
    playbackState: !hasActiveStream ? "none" : paused ? "paused" : "playing",
    durationSec: toDisplaySeconds(duration),
    positionSec: toDisplaySeconds(time),
    onPlay: () => setPaused(false),
    onPause: () => setPaused(true),
    onSeek: (timeSec) => setTime(timeSec * 1000),
    onSeekBy: (deltaSec) => skipBy(deltaSec * 1000),
  });

  return (
    <div
      className={`player-container ${hideOverlay ? "overlay-hidden" : ""}`}
      onMouseMove={onActivity}
      onTouchMove={onActivity}
      onTouchStart={onActivity}
    >
      <div
        role="button"
        tabIndex={0}
        className="player-video-layer"
        aria-label={paused ? "Play video" : "Pause video"}
        onClick={togglePlayPause}
        onKeyDown={handleVideoLayerKeyDown}
      >
        <div className="player-video-container">
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>

      {showSourcePicker ? (
        <StreamSourcePicker
          sources={sources}
          loading={sourcesLoading}
          error={sourcesError ?? undefined}
          disabled={sourcesLoading || resolving}
          selectedId={selectedSource?.id}
          compatFiltersRelaxed={skipCompatFilters}
          onSelect={handleSelectSource}
          onRetry={() => {
            void loadSources();
          }}
          onRelaxCompatFilters={() => {
            setSkipCompatFilters(true);
          }}
        />
      ) : null}

      {buffering ? (
        <div className="player-buffering">
          <div className="player-spinner" />
          {resolving ? (
            <ResolveProgressHint
              active
              progress={fallbackProgress ?? resolveState.progress}
              className="flex flex-col items-center"
            />
          ) : (
            <p>{fallbackProgress ?? resolveState.progress ?? "Buffering..."}</p>
          )}
          {resolving && selectedSource ? (
            <p className="max-w-md px-4 text-center text-sm text-zinc-400">
              Resolving {selectedSource.title}
            </p>
          ) : null}
        </div>
      ) : null}

      {failed ? (
        <PlayerErrorOverlay
          message={playbackError ?? resolveState.error ?? "Stream resolve failed."}
          onRetryStreams={resetToSourcePicker}
          backPath={backPath}
          homePath="/"
        />
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
            <ExternalPlayerMenu
              playbackUrl={resolveState.playbackUrl ?? null}
              disabled={failed || buffering || showSourcePicker}
            />
          </div>
        </div>

        {!failed && !buffering && !showSourcePicker ? (
          <ControlBar
            paused={paused}
            time={time}
            duration={duration}
            volume={volume}
            muted={muted}
            onPlayRequested={() => setPaused(false)}
            onPauseRequested={() => setPaused(true)}
            onSeekRequested={(nextTime) => setTime(nextTime)}
            onSkipBackward={() => skipBy(-15_000)}
            onSkipForward={() => skipBy(15_000)}
            onVolumeChange={setVolume}
            onMuteToggle={handleMuteToggle}
            nextEpisode={
              showNextEpisode && nextEpisode
                ? { label: nextEpisode.label, onClick: goToNextEpisode }
                : null
            }
          />
        ) : null}
      </div>
    </div>
  );
}

