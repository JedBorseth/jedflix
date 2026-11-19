import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMediaSession } from "@/hooks/useMediaSession";
import type { SourcesRequest, StreamSource } from "@/lib/streamApi";
import { copyTextToClipboard } from "@/lib/clipboard";
import { isDirectPlaybackIncompatible } from "@jedflix/shared";
import { IOS_PLAYBACK_ERROR_HINT, isIosDevice } from "@/lib/iosPlayback";
import { formatWatchSessionTitle, playMediaElement } from "@/lib/mediaSession";
import { catalogQueryKeys } from "@/lib/queryClient";
import { getTvSeasons, getWatchPath } from "@/lib/tmdb";
import type { MediaType } from "@/lib/types";
import { ExternalPlayerMenu } from "../shared/ExternalPlayerMenu";
import { PlayerErrorOverlay } from "../shared/PlayerErrorOverlay";
import { findNextFallbackSourceIndex, isFallbackError, MAX_AUTO_FALLBACKS } from "../shared/playbackErrors";
import { ResolveProgressHint } from "../shared/ResolveProgressHint";
import {
  isInNextEpisodeWindow,
  resolveNextEpisode,
} from "../shared/resolveNextEpisode";
import { useStreamSources } from "../shared/useStreamSources";
import { useWatchProgressSaver } from "../shared/useWatchProgressSaver";
import { StreamSourcePicker } from "../stremio/StreamSourcePicker";
import { useStreamResolve } from "../stremio/useStreamResolve";
import "../stremio/player.css";

type NativeVideoPlayerProps = {
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

export function NativeVideoPlayer({
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
}: NativeVideoPlayerProps) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const initialProgressAppliedRef = useRef(false);
  const fallbackAttemptsRef = useRef(0);
  const failedFallbackSourcesRef = useRef(new Set<string>());
  const [skipCompatFilters, setSkipCompatFilters] = useState(false);
  const [selectedSource, setSelectedSource] = useState<StreamSource | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(true);
  const [fallbackProgress, setFallbackProgress] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [clipboardCopied, setClipboardCopied] = useState(false);
  const [iosCodecWarning, setIosCodecWarning] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  const progressSaver = useWatchProgressSaver(movieId, mediaType, season, episode);

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
    nextEpisode !== null &&
    !showSourcePicker &&
    isInNextEpisodeWindow(positionSec * 1000, durationSec * 1000);

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

  const resetForSourceLoad = useCallback(() => {
    setSelectedSource(null);
    setFallbackProgress(null);
    setPlaybackError(null);
    setClipboardCopied(false);
    setIosCodecWarning(null);
    fallbackAttemptsRef.current = 0;
    failedFallbackSourcesRef.current.clear();
    loadedUrlRef.current = null;
    initialProgressAppliedRef.current = false;
    setShowSourcePicker(true);
  }, []);

  const sourcesRequest = useMemo<SourcesRequest>(
    () => ({
      ...baseRequest,
      playbackProfile: skipCompatFilters ? "external" : "browser",
    }),
    [baseRequest, skipCompatFilters],
  );

  const { sources, sourcesLoading, sourcesError, loadSources } = useStreamSources(
    sourcesRequest,
    realDebridApiKey.trim() || undefined,
    resetForSourceLoad,
  );

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
  const failed = resolveState.status === "failed" || playbackError !== null;
  const buffering = Boolean(resolving && !failed);

  const absolutePlaybackUrl = useMemo(() => {
    if (!resolveState.playbackUrl) {
      return null;
    }
    return resolveState.playbackUrl;
  }, [resolveState.playbackUrl]);

  useEffect(() => {
    if (!absolutePlaybackUrl || loadedUrlRef.current === absolutePlaybackUrl) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    setPlaybackError(null);
    loadedUrlRef.current = absolutePlaybackUrl;
    initialProgressAppliedRef.current = false;
    setPlaying(false);
    setPositionSec(0);
    setDurationSec(0);
    video.src = absolutePlaybackUrl;
    void playMediaElement(video);
  }, [absolutePlaybackUrl]);

  const sessionTitle = formatWatchSessionTitle(
    title,
    mediaType === "tv" ? "tv" : "movie",
    season,
    episode,
  );
  const hasActiveStream = Boolean(absolutePlaybackUrl) && !showSourcePicker;

  useMediaSession({
    title: sessionTitle,
    artist: mediaType === "tv" ? title : "Movie",
    album: mediaType === "tv" && season != null ? `Season ${season}` : title,
    artworkUrl,
    enabled: hasActiveStream,
    playbackState: !hasActiveStream ? "none" : playing ? "playing" : "paused",
    durationSec: durationSec > 0 ? durationSec : undefined,
    positionSec,
    onPlay: () => {
      const video = videoRef.current;
      if (video) {
        void playMediaElement(video);
      }
    },
    onPause: () => {
      videoRef.current?.pause();
    },
    onSeek: (timeSec) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }
      video.currentTime = Math.max(0, Math.min(video.duration || 0, timeSec));
      setPositionSec(video.currentTime);
    },
    onSeekBy: (deltaSec) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }
      video.currentTime = Math.max(
        0,
        Math.min(video.duration || 0, video.currentTime + deltaSec),
      );
      setPositionSec(video.currentTime);
    },
  });

  const handleSelectSource = useCallback(
    (source: StreamSource) => {
      if (sourcesLoading || resolving) {
        return;
      }
      if (selectedSource?.id === source.id) {
        return;
      }
      fallbackAttemptsRef.current = 0;
      failedFallbackSourcesRef.current.clear();
      setFallbackProgress(null);
      setPlaybackError(null);
      setClipboardCopied(false);
      setIosCodecWarning(
        isIosDevice() && isDirectPlaybackIncompatible(`${source.title} ${source.info ?? ""}`)
          ? "This release may play without audio in Safari. Pick a Web-DL or x264 stream if sound is missing."
          : null,
      );
      setSelectedSource(source);
      setShowSourcePicker(false);
    },
    [resolving, selectedSource?.id, sourcesLoading],
  );

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

    const nextIndex = findNextFallbackSourceIndex(sources, selectedSource, failedFallbackSourcesRef.current);
    const nextSource = sources[nextIndex];
    if (!nextSource) {
      return;
    }

    fallbackAttemptsRef.current += 1;
    setFallbackProgress(`Trying stream ${nextIndex + 1} of ${sources.length}`);
    loadedUrlRef.current = null;
    setSelectedSource(nextSource);
  }, [resolveState.error, resolveState.errorCode, resolveState.status, selectedSource, sources]);

  const handlePlaybackError = useCallback(() => {
    if (!selectedSource) {
      setPlaybackError(
        isIosDevice()
          ? IOS_PLAYBACK_ERROR_HINT
          : "This stream could not be played on your device. Try another compatible source or an external player.",
      );
      return;
    }

    if (fallbackAttemptsRef.current >= MAX_AUTO_FALLBACKS) {
      const message = isIosDevice()
        ? IOS_PLAYBACK_ERROR_HINT
        : "This stream could not be played on your device. Try another compatible source or an external player.";
      setPlaybackError(
        `${message} Stopped after ${MAX_AUTO_FALLBACKS + 1} attempts to avoid Real Debrid rate limits.`,
      );
      return;
    }

    const nextIndex = findNextFallbackSourceIndex(sources, selectedSource, failedFallbackSourcesRef.current);
    const nextSource = sources[nextIndex];
    if (nextSource) {
      fallbackAttemptsRef.current += 1;
      setFallbackProgress(`Trying stream ${nextIndex + 1} of ${sources.length}`);
      loadedUrlRef.current = null;
      setSelectedSource(nextSource);
      return;
    }

    const message = isIosDevice()
      ? IOS_PLAYBACK_ERROR_HINT
      : "This stream could not be played on your device. Try another compatible source or an external player.";
    setPlaybackError(message);
    if (absolutePlaybackUrl) {
      void copyTextToClipboard(absolutePlaybackUrl).then((copied) => {
        setClipboardCopied(copied);
      });
    }
  }, [absolutePlaybackUrl, selectedSource, sources]);

  return (
    <div className="player-container">
      <div className="player-video-container">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={(event) => {
            setPlaying(false);
            progressSaver.finish(Math.floor(event.currentTarget.currentTime));
          }}
          onEnded={(event) => {
            progressSaver.finish(Math.floor(event.currentTarget.currentTime));
          }}
          onLoadedMetadata={() => {
            const video = videoRef.current;
            if (!video) {
              return;
            }
            setDurationSec(video.duration || 0);
            if (!initialProgressAppliedRef.current && initialProgressSeconds > 0) {
              // Seek before relying on the earlier play() so resume does not abort playback.
              video.currentTime = initialProgressSeconds;
              initialProgressAppliedRef.current = true;
              setPositionSec(initialProgressSeconds);
              void playMediaElement(video);
            }
          }}
          onTimeUpdate={() => {
            const video = videoRef.current;
            if (!video || video.currentTime <= 0) {
              return;
            }
            setPositionSec(video.currentTime);
            progressSaver.update(Math.floor(video.currentTime));
          }}
          onError={handlePlaybackError}
        />
      </div>

      {iosCodecWarning ? (
        <div className="absolute left-0 right-0 top-0 z-20 bg-amber-500/90 px-4 py-2 text-center text-sm text-black">
          {iosCodecWarning}
        </div>
      ) : null}

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
              onChooseAnotherStream={() => {
                setSelectedSource(null);
                setFallbackProgress(null);
                fallbackAttemptsRef.current = 0;
                failedFallbackSourcesRef.current.clear();
                setShowSourcePicker(true);
              }}
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
          onRetryStreams={() => {
            setSelectedSource(null);
            setFallbackProgress(null);
            setPlaybackError(null);
            setClipboardCopied(false);
            fallbackAttemptsRef.current = 0;
            failedFallbackSourcesRef.current.clear();
            loadedUrlRef.current = null;
            setShowSourcePicker(true);
          }}
          backPath={backPath}
          homePath="/"
        >
          {clipboardCopied && absolutePlaybackUrl ? (
            <p className="text-sm text-emerald-400">Stream URL copied to clipboard.</p>
          ) : null}
          {absolutePlaybackUrl ? (
            <button
              type="button"
              className="rounded-md border border-zinc-600 px-4 py-2 text-white"
              onClick={() => {
                void copyTextToClipboard(absolutePlaybackUrl).then((copied) => {
                  setClipboardCopied(copied);
                });
              }}
            >
              Copy stream URL
            </button>
          ) : null}
        </PlayerErrorOverlay>
      ) : null}

      <div className="player-overlay pointer-events-none">
        <div className="player-top-bar pointer-events-auto">
          <div className="player-top-bar-left">
            <Link to={backPath} className="player-icon-button" aria-label="Back">
              ←
            </Link>
            <div className="min-w-0">
              <div className="player-title truncate">{title}</div>
              {mediaType === "tv" && season && episode ? (
                <div className="text-xs text-zinc-400">
                  Season {season} · Episode {episode}
                </div>
              ) : null}
            </div>
          </div>
          <div className="player-top-bar-right">
            <ExternalPlayerMenu
              playbackUrl={absolutePlaybackUrl}
              disabled={failed || buffering || showSourcePicker}
            />
          </div>
        </div>
        {showNextEpisode && nextEpisode ? (
          <div className="player-control-bar pointer-events-auto">
            <div className="player-next-episode-row">
              <button
                type="button"
                className="player-next-episode-button"
                onClick={() => {
                  void navigate(
                    getWatchPath("tv", movieId, nextEpisode.season, nextEpisode.episode),
                  );
                }}
              >
                {nextEpisode.label}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
