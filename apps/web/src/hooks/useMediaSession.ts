import { useEffect, useRef } from "react";
import {
  artworkFromImageUrl,
  clearMediaSessionActionHandlers,
  configurePlaybackAudioSession,
  hasMediaSessionSupport,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
  shouldUpdateMediaPosition,
  type MediaSessionPlaybackState,
} from "@/lib/mediaSession";

export type UseMediaSessionOptions = {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string | null;
  enabled?: boolean;
  playbackState?: MediaSessionPlaybackState;
  durationSec?: number;
  positionSec?: number;
  playbackRate?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (timeSec: number) => void;
  onSeekBy?: (deltaSec: number) => void;
  onPreviousTrack?: () => void;
  onNextTrack?: () => void;
  onStop?: () => void;
  /**
   * When true, skip ±10s seek handlers so the OS shows next/previous track
   * controls (preferred for music on iOS lock screen / Control Center).
   */
  preferTrackSkip?: boolean;
  /** Rebind next/previous when this changes (e.g. current track id). */
  actionHandlerKey?: string;
  /**
   * Minimum time between setPositionState calls. Frequent updates make iOS
   * revert lock-screen buttons to skip ±10s. Music should use ~1000ms.
   */
  positionMinIntervalMs?: number;
};

/**
 * Publishes Media Session metadata and lock-screen / headset controls for the
 * active movie, show, or audiobook.
 */
export function useMediaSession({
  title,
  artist,
  album,
  artworkUrl,
  enabled = true,
  playbackState = "none",
  durationSec,
  positionSec,
  playbackRate = 1,
  onPlay,
  onPause,
  onSeek,
  onSeekBy,
  onPreviousTrack,
  onNextTrack,
  onStop,
  preferTrackSkip = false,
  actionHandlerKey,
  positionMinIntervalMs = 0,
}: UseMediaSessionOptions) {
  const handlersRef = useRef({
    onPlay,
    onPause,
    onSeek,
    onSeekBy,
    onPreviousTrack,
    onNextTrack,
    onStop,
  });
  handlersRef.current = {
    onPlay,
    onPause,
    onSeek,
    onSeekBy,
    onPreviousTrack,
    onNextTrack,
    onStop,
  };
  const lastPositionPublishRef = useRef(0);
  const lastPublishedPositionRef = useRef(0);
  const lastDurationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !title || !hasMediaSessionSupport()) {
      return;
    }

    configurePlaybackAudioSession();
    setMediaSessionMetadata({
      title,
      artist,
      album,
      artwork: artworkFromImageUrl(artworkUrl),
    });

    const previousTitle = document.title;
    document.title = `${title} · JedFlix`;

    return () => {
      document.title = previousTitle;
    };
  }, [album, artist, artworkUrl, enabled, title]);

  useEffect(() => {
    if (!enabled || !hasMediaSessionSupport()) {
      return;
    }

    setMediaSessionPlaybackState(playbackState);
  }, [enabled, playbackState]);

  useEffect(() => {
    if (!enabled || !hasMediaSessionSupport()) {
      return;
    }

    if (durationSec == null || positionSec == null) {
      setMediaSessionPositionState(null);
      lastPositionPublishRef.current = 0;
      return;
    }

    const now = Date.now();
    const durationChanged = lastDurationRef.current !== durationSec;
    lastDurationRef.current = durationSec;
    const force = durationChanged || playbackState !== "playing";
    if (
      !shouldUpdateMediaPosition({
        lastPublishedAtMs: lastPositionPublishRef.current,
        nowMs: now,
        intervalMs: positionMinIntervalMs,
        force,
        lastPositionSec: lastPublishedPositionRef.current,
        nextPositionSec: positionSec,
      })
    ) {
      return;
    }

    lastPositionPublishRef.current = now;
    lastPublishedPositionRef.current = positionSec;
    setMediaSessionPositionState({
      duration: durationSec,
      position: positionSec,
      playbackRate,
    });
  }, [
    durationSec,
    enabled,
    playbackRate,
    playbackState,
    positionMinIntervalMs,
    positionSec,
  ]);

  useEffect(() => {
    if (!enabled || !hasMediaSessionSupport()) {
      clearMediaSessionActionHandlers();
      return;
    }

    configurePlaybackAudioSession();
    const mediaSession = navigator.mediaSession;

    const bind = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported action on this browser.
      }
    };

    bind("play", () => {
      handlersRef.current.onPlay?.();
    });
    bind("pause", () => {
      handlersRef.current.onPause?.();
    });
    bind("stop", () => {
      handlersRef.current.onStop?.() ?? handlersRef.current.onPause?.();
    });
    if (preferTrackSkip) {
      // Explicit null (not omit) so iOS does not fall back to ±10s seek.
      bind("seekbackward", null);
      bind("seekforward", null);
      bind("seekto", null);
    } else {
      bind("seekbackward", (details) => {
        const offset = details.seekOffset ?? 10;
        handlersRef.current.onSeekBy?.(-offset);
      });
      bind("seekforward", (details) => {
        const offset = details.seekOffset ?? 10;
        handlersRef.current.onSeekBy?.(offset);
      });
      bind("seekto", (details) => {
        if (typeof details.seekTime === "number") {
          handlersRef.current.onSeek?.(details.seekTime);
        }
      });
    }
    bind("previoustrack", () => {
      handlersRef.current.onPreviousTrack?.();
    });
    bind("nexttrack", () => {
      handlersRef.current.onNextTrack?.();
    });

    const reassertTrackSkip = () => {
      if (!preferTrackSkip || !hasMediaSessionSupport()) {
        return;
      }
      bind("seekbackward", null);
      bind("seekforward", null);
      bind("seekto", null);
      bind("previoustrack", () => {
        handlersRef.current.onPreviousTrack?.();
      });
      bind("nexttrack", () => {
        handlersRef.current.onNextTrack?.();
      });
    };
    document.addEventListener("visibilitychange", reassertTrackSkip);
    window.addEventListener("pageshow", reassertTrackSkip);

    return () => {
      document.removeEventListener("visibilitychange", reassertTrackSkip);
      window.removeEventListener("pageshow", reassertTrackSkip);
    };
    // Do not clear handlers on rebind — the gap lets iOS revert to ±10s skip.
  }, [actionHandlerKey, enabled, preferTrackSkip]);

  useEffect(() => {
    return () => {
      clearMediaSessionActionHandlers();
    };
  }, []);
}
