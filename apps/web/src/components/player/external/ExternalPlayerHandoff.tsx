import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSources, getExternalPlaybackUrl, type StreamSource } from "@/lib/streamApi";
import {
  buildExternalPlayerUrl,
  getExternalPlayerLabel,
  openExternalPlayer,
  toAbsolutePlaybackUrl,
} from "@/lib/externalPlayer";
import { copyTextToClipboard } from "@/lib/clipboard";
import { sortDirectPlaybackSources } from "@/lib/iosPlayback";
import type { ExternalPlayer } from "@/lib/userSettings";
import type { MediaType } from "@/lib/types";
import { PlayerErrorOverlay } from "../shared/PlayerErrorOverlay";
import { isFallbackError, MAX_AUTO_FALLBACKS } from "../shared/playbackErrors";
import { ResolveProgressHint } from "../shared/ResolveProgressHint";
import { StreamSourcePicker } from "../stremio/StreamSourcePicker";
import { useStreamResolve } from "../stremio/useStreamResolve";
import "../stremio/player.css";

type ExternalPlayerHandoffProps = {
  mediaType: MediaType;
  title: string;
  imdbId: string;
  season?: number;
  episode?: number;
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
  realDebridApiKey = "",
  backPath,
  externalPlayer,
}: ExternalPlayerHandoffProps) {
  const openedUrlRef = useRef<string | null>(null);
  const fallbackAttemptsRef = useRef(0);
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
      mediaTitle: title,
    }),
    [episode, imdbId, mediaType, season, title],
  );

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    setSelectedSource(null);
    setFallbackProgress(null);
    setOpenFailed(false);
    setClipboardCopied(false);
    fallbackAttemptsRef.current = 0;
    openedUrlRef.current = null;
    setShowSourcePicker(true);
    try {
      const found = await fetchSources(
        { ...baseRequest, playbackProfile: "external" },
        realDebridApiKey.trim() || undefined,
      );
      setSources(sortDirectPlaybackSources(found));
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
      fallbackAttemptsRef.current = 0;
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
    if (resolveState.status !== "failed" || !selectedSource) {
      return;
    }
    if (resolveState.errorCode === "rate_limited" || !isFallbackError(resolveState.errorCode)) {
      return;
    }
    if (fallbackAttemptsRef.current >= MAX_AUTO_FALLBACKS) {
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
          compatFiltersRelaxed
          onSelect={handleSelectSource}
          onRetry={() => {
            void loadSources();
          }}
        />
      ) : null}

      {resolving ? (
        <div className="player-buffering">
          <div className="player-spinner" />
          <ResolveProgressHint
            active
            progress={fallbackProgress ?? resolveState.progress ?? "Resolving stream..."}
            className="flex flex-col items-center"
          />
          {selectedSource ? (
            <p className="max-w-md px-4 text-center text-sm text-zinc-400">
              Preparing {selectedSource.title} for {playerLabel}
            </p>
          ) : null}
        </div>
      ) : null}

      {failed ? (
        <PlayerErrorOverlay
          title="Unable to open stream"
          message={resolveState.error ?? "Stream resolve failed."}
          onRetryStreams={() => {
            setSelectedSource(null);
            setFallbackProgress(null);
            fallbackAttemptsRef.current = 0;
            openedUrlRef.current = null;
            setShowSourcePicker(true);
          }}
          backPath={backPath}
          homePath="/"
        />
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

