import { useEffect, useRef } from "react";
import {
  artworkFromImageUrl,
  clearMediaSession,
  clearMediaSessionActionHandlers,
  hasMediaSessionSupport,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
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

  useEffect(() => {
    if (!enabled || !title || !hasMediaSessionSupport()) {
      return;
    }

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
      return;
    }

    setMediaSessionPositionState({
      duration: durationSec,
      position: positionSec,
      playbackRate,
    });
  }, [durationSec, enabled, playbackRate, positionSec]);

  useEffect(() => {
    if (!enabled || !hasMediaSessionSupport()) {
      return;
    }

    const mediaSession = navigator.mediaSession;
    clearMediaSessionActionHandlers(mediaSession);

    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
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
    bind("previoustrack", () => {
      handlersRef.current.onPreviousTrack?.();
    });
    bind("nexttrack", () => {
      handlersRef.current.onNextTrack?.();
    });

    return () => {
      clearMediaSession();
    };
  }, [enabled]);
}
