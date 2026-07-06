import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSources, getExternalPlaybackUrl, type StreamMode, type StreamSource } from "@/lib/streamApi";
import {
  buildExternalPlayerUrl,
  getExternalPlayerLabel,
  openExternalPlayer,
  toAbsolutePlaybackUrl,
} from "@/lib/externalPlayer";
import { copyTextToClipboard } from "@/lib/clipboard";
import { sortSourcesForIosPlayback } from "@/lib/iosPlayback";
import type { ExternalPlayer } from "@/lib/userSettings";
import type { MediaType } from "@/lib/types";
import { StreamSourcePicker } from "../stremio/StreamSourcePicker";
import { useStreamResolve } from "../stremio/useStreamResolve";
import "../stremio/player.css";

type ExternalPlayerHandoffProps = {
  mediaType: MediaType;
  title: string;
  imdbId: string;
  season?: number;
  episode?: number;
  mode: StreamMode;
  realDebridApiKey?: string;
  backPath: string;
  externalPlayer: Exclude<ExternalPlayer, "disabled">;
};

export function ExternalPlayerHandoff({
  mediaType,
  title,
  imdbId,
  season,
  episode,
  mode,
  realDebridApiKey = "",
  backPath,
  externalPlayer,
}: ExternalPlayerHandoffProps) {
  const openedUrlRef = useRef<string | null>(null);
  const [sources, setSources] = useState<StreamSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<StreamSource | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(true);
  const [fallbackProgress, setFallbackProgress] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [clipboardCopied, setClipboardCopied] = useState(false);

  const playerLabel = getExternalPlayerLabel(externalPlayer);

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
    setOpenFailed(false);
    setClipboardCopied(false);
    openedUrlRef.current = null;
    setShowSourcePicker(true);
    try {
      const found = await fetchSources(baseRequest, realDebridApiKey.trim() || undefined);
      setSources(sortSourcesForIosPlayback(found));
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
  const failed = resolveState.status === "failed";
  const externalPlaybackUrl = useMemo(() => {
    if (!resolveState.stream) {
      return null;
    }
    return getExternalPlaybackUrl(resolveState.stream);
  }, [resolveState.stream]);
  const ready = resolveState.status === "ready" && Boolean(externalPlaybackUrl);

  useEffect(() => {
    if (!ready || !externalPlaybackUrl || openedUrlRef.current === externalPlaybackUrl) {
      return;
    }

    openedUrlRef.current = externalPlaybackUrl;
    setOpenFailed(false);
    setClipboardCopied(false);

    void openExternalPlayer(externalPlayer, externalPlaybackUrl).then(({ copied }) => {
      setClipboardCopied(copied);
    });

    const timeout = window.setTimeout(() => {
      setOpenFailed(true);
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [externalPlaybackUrl, externalPlayer, ready]);

  const absolutePlaybackUrl = useMemo(() => {
    if (!externalPlaybackUrl) {
      return null;
    }
    return toAbsolutePlaybackUrl(externalPlaybackUrl);
  }, [externalPlaybackUrl]);

  const handleSelectSource = useCallback(
    (source: StreamSource) => {
      if (sourcesLoading || resolving) {
        return;
      }
      if (selectedSource?.id === source.id) {
        return;
      }
      setFallbackProgress(null);
      setOpenFailed(false);
      setClipboardCopied(false);
      openedUrlRef.current = null;
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
    openedUrlRef.current = null;
    setSelectedSource(nextSource);
  }, [resolveState.errorCode, resolveState.status, selectedSource, sources]);

  const externalUrl =
    externalPlaybackUrl && ready
      ? buildExternalPlayerUrl(externalPlayer, externalPlaybackUrl)
      : null;

  return (
    <div className="player-container">
      <div className="flex min-h-[100dvh] items-center justify-center bg-black px-6 text-center text-white">
        {showSourcePicker ? null : ready ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Opening in {playerLabel}…</h2>
            <p className="text-zinc-400">
              {title}
              {mediaType === "tv" && season && episode
                ? ` · S${season}E${episode}`
                : ""}
            </p>
            {clipboardCopied ? (
              <p className="text-sm text-emerald-400">Stream URL copied to clipboard.</p>
            ) : absolutePlaybackUrl ? (
              <p className="text-sm text-zinc-500">
                If {playerLabel} does not open, paste the stream URL manually.
              </p>
            ) : null}
            {openFailed && externalUrl ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <a
                  href={externalUrl}
                  className="inline-block rounded-md bg-white px-4 py-2 text-black"
                >
                  Open in {playerLabel}
                </a>
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
              </div>
            ) : null}
            <div>
              <Link to={backPath} className="text-sm text-zinc-400 underline">
                Back to title
              </Link>
            </div>
          </div>
        ) : null}
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

      {resolving ? (
        <div className="player-buffering">
          <div className="player-spinner" />
          <p>{fallbackProgress ?? resolveState.progress ?? "Resolving stream..."}</p>
          {selectedSource ? (
            <p className="max-w-md px-4 text-center text-sm text-zinc-400">
              Preparing {selectedSource.title} for {playerLabel}
            </p>
          ) : null}
        </div>
      ) : null}

      {failed ? (
        <div className="player-error">
          <h2 className="text-xl font-semibold">Unable to open stream</h2>
          <p className="text-zinc-300">{resolveState.error ?? "Stream resolve failed."}</p>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-md bg-white px-4 py-2 text-black"
              onClick={() => {
                setSelectedSource(null);
                setFallbackProgress(null);
                openedUrlRef.current = null;
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
            <span className="player-mode-badge">{playerLabel}</span>
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
