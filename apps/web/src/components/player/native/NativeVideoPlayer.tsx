import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { fetchSources, type StreamSource } from "@/lib/streamApi";
import { copyTextToClipboard } from "@/lib/clipboard";
import { IOS_PLAYBACK_ERROR_HINT, isIosDevice, prepareBrowserSources } from "@/lib/iosPlayback";
import type { MediaType } from "@/lib/types";
import { ExternalPlayerMenu } from "../shared/ExternalPlayerMenu";
import { PlayerErrorOverlay } from "../shared/PlayerErrorOverlay";
import { isFallbackError, MAX_AUTO_FALLBACKS } from "../shared/playbackErrors";
import { StreamSourcePicker } from "../stremio/StreamSourcePicker";
import { useStreamResolve } from "../stremio/useStreamResolve";
import {
  artworkFromUrl,
  bindMediaSessionHandlers,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
} from "@/lib/mediaSession";
import "../stremio/player.css";

type NativeVideoPlayerProps = {
  movieId: number;
  mediaType: MediaType;
  title: string;
  posterUrl?: string;
  imdbId: string;
  season?: number;
  episode?: number;
  realDebridApiKey?: string;
  initialProgressSeconds?: number;
  backPath: string;
};

type DebouncedSaveProgress = ((progressSeconds: number) => void) & { cancel: () => void };

export function NativeVideoPlayer({
  movieId,
  mediaType,
  title,
  posterUrl,
  imdbId,
  season,
  episode,
  realDebridApiKey = "",
  initialProgressSeconds = 0,
  backPath,
}: NativeVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const initialProgressAppliedRef = useRef(false);
  const fallbackAttemptsRef = useRef(0);
  const [sources, setSources] = useState<StreamSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [skipCompatFilters, setSkipCompatFilters] = useState(false);
  const [selectedSource, setSelectedSource] = useState<StreamSource | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(true);
  const [fallbackProgress, setFallbackProgress] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [clipboardCopied, setClipboardCopied] = useState(false);
  const [iosCodecWarning, setIosCodecWarning] = useState<string | null>(null);

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
    setClipboardCopied(false);
    setIosCodecWarning(null);
    fallbackAttemptsRef.current = 0;
    loadedUrlRef.current = null;
    initialProgressAppliedRef.current = false;
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
    video.src = absolutePlaybackUrl;
    void video.play().catch(() => {
      // Autoplay may be blocked until user interaction.
    });
  }, [absolutePlaybackUrl]);

  useEffect(() => {
    if (!absolutePlaybackUrl) {
      return;
    }
    setMediaSessionMetadata({
      title,
      artist: mediaType === "tv" ? "TV Show" : "Movie",
      album: "JedFlix",
      artwork: artworkFromUrl(posterUrl),
    });
  }, [absolutePlaybackUrl, mediaType, posterUrl, title]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const onPlay = () => setMediaSessionPlaybackState("playing");
    const onPause = () => setMediaSessionPlaybackState("paused");
    const onTimeUpdate = () => {
      setMediaSessionPositionState({
        duration: video.duration || 0,
        position: video.currentTime || 0,
        playbackRate: video.playbackRate || 1,
      });
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [absolutePlaybackUrl]);

  useEffect(() => {
    return bindMediaSessionHandlers({
      play: () => {
        void videoRef.current?.play();
      },
      pause: () => {
        videoRef.current?.pause();
      },
      seekbackward: (details) => {
        const video = videoRef.current;
        if (!video) {
          return;
        }
        video.currentTime = Math.max(0, video.currentTime - (details.seekOffset ?? 15));
      },
      seekforward: (details) => {
        const video = videoRef.current;
        if (!video) {
          return;
        }
        video.currentTime = Math.min(
          video.duration || 0,
          video.currentTime + (details.seekOffset ?? 15),
        );
      },
      seekto: (details) => {
        const video = videoRef.current;
        if (!video || details.seekTime == null) {
          return;
        }
        video.currentTime = details.seekTime;
      },
    });
  }, []);

  useEffect(() => {
    const saveProgress = saveProgressRef.current;
    return () => {
      saveProgress?.cancel();
    };
  }, []);

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
      setClipboardCopied(false);
      setIosCodecWarning(
        isIosDevice() && /remux|dts|truehd|atmos|ac3|eac3/i.test(source.title)
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

    const currentIndex = sources.findIndex((source) => source.id === selectedSource.id);
    const nextSource = sources[currentIndex + 1];
    if (nextSource) {
      fallbackAttemptsRef.current += 1;
      setFallbackProgress(`Trying stream ${currentIndex + 2} of ${sources.length}`);
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
          onLoadedMetadata={() => {
            const video = videoRef.current;
            if (!video || initialProgressAppliedRef.current || initialProgressSeconds <= 0) {
              return;
            }
            video.currentTime = initialProgressSeconds;
            initialProgressAppliedRef.current = true;
          }}
          onTimeUpdate={() => {
            const video = videoRef.current;
            if (!video || video.currentTime <= 0) {
              return;
            }
            saveProgressRef.current?.(Math.floor(video.currentTime));
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
          <p>{fallbackProgress ?? resolveState.progress ?? "Buffering..."}</p>
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
      </div>
    </div>
  );
}
