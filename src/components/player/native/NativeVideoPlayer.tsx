import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useScreenOrientationLock } from "@/hooks/useScreenOrientationLock";
import { fetchSources, resolveStreamUrl, type StreamMode, type StreamSource } from "@/lib/streamApi";
import type { MediaType } from "@/lib/types";
import { StreamSourcePicker } from "../stremio/StreamSourcePicker";
import { useStreamResolve } from "../stremio/useStreamResolve";
import "../stremio/player.css";

type NativeVideoPlayerProps = {
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

export function NativeVideoPlayer({
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
}: NativeVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const initialProgressAppliedRef = useRef(false);
  const [sources, setSources] = useState<StreamSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<StreamSource | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(true);
  const [fallbackProgress, setFallbackProgress] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

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
    setPlaybackError(null);
    loadedUrlRef.current = null;
    initialProgressAppliedRef.current = false;
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
  const failed = resolveState.status === "failed" || playbackError !== null;
  const buffering = Boolean(resolving && !failed);

  const absolutePlaybackUrl = useMemo(() => {
    if (!resolveState.playbackUrl) {
      return null;
    }
    return resolveStreamUrl(resolveState.playbackUrl);
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
    const saveProgress = saveProgressRef.current;
    return () => {
      saveProgress?.cancel();
    };
  }, []);

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
      setPlaybackError(null);
      setSelectedSource(source);
      setShowSourcePicker(false);
    },
    [resolving, selectedSource?.id, sourcesLoading],
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

  return (
    <div className="player-container">
      <div className="player-video-container">
        <video
          ref={videoRef}
          className="h-full w-full bg-black object-contain"
          controls
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
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
          onError={() => {
            setPlaybackError("This stream could not be played on your device. Try another source or use proxy mode.");
            setIsPlaying(false);
          }}
        />
      </div>

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
          <p className="text-zinc-300">
            {playbackError ?? resolveState.error ?? "Stream resolve failed."}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-md bg-white px-4 py-2 text-black"
              onClick={() => {
                setSelectedSource(null);
                setFallbackProgress(null);
                setPlaybackError(null);
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

      <div className="player-overlay pointer-events-none">
        <div className="player-top-bar pointer-events-auto">
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
