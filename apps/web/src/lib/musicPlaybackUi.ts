import type { MediaSessionPlaybackState } from "./mediaSession";

/** HTMLMediaElement.HAVE_CURRENT_DATA — current playback position has frames. */
export const MEDIA_HAVE_CURRENT_DATA = 2;

export type MusicAudibleEvent =
  | "srcswap"
  | "timeupdate"
  | "canplay"
  | "waiting"
  | "error"
  | "pause"
  | "ended";

export type MusicPlaybackPresentation = {
  playing: boolean;
  loading: boolean;
  playbackState: MediaSessionPlaybackState;
  /**
   * True only when the lock-screen clock may advance at 1×.
   * False while resolving or paused — do not publish a playing position.
   */
  publishPosition: boolean;
  /** Elapsed seconds to show / publish. Frozen at 0 until audible. */
  positionSec: number;
};

/**
 * Map user intent + whether audio is actually flowing to in-app and
 * Media Session UI. `playIntent` is “the user wants sound”; `audible` is
 * “the element has produced data”.
 */
export function musicPlaybackPresentation(input: {
  hasCurrent: boolean;
  playIntent: boolean;
  audible: boolean;
  hasError?: boolean;
  /** True when the element already has frames (resume vs cold resolve). */
  hasData?: boolean;
  elapsedSec?: number;
}): MusicPlaybackPresentation {
  const elapsed = Number.isFinite(input.elapsedSec)
    ? Math.max(0, input.elapsedSec!)
    : 0;

  if (!input.hasCurrent) {
    return {
      playing: false,
      loading: false,
      playbackState: "none",
      publishPosition: false,
      positionSec: 0,
    };
  }

  if (input.hasError) {
    return {
      playing: false,
      loading: false,
      playbackState: "paused",
      publishPosition: false,
      positionSec: elapsed,
    };
  }

  if (input.audible) {
    return {
      playing: true,
      loading: false,
      playbackState: "playing",
      publishPosition: true,
      positionSec: elapsed,
    };
  }

  if (input.playIntent) {
    return {
      playing: false,
      loading: !input.hasData,
      playbackState: "paused",
      publishPosition: false,
      // Src swap zeros elapsed; resume keeps the paused position.
      positionSec: elapsed,
    };
  }

  return {
    playing: false,
    loading: false,
    playbackState: "paused",
    publishPosition: false,
    positionSec: elapsed,
  };
}

/**
 * Next `audible` value from a media element event.
 * Becomes true only with data and a real timeupdate, or canplay with
 * HAVE_CURRENT_DATA and the element not paused.
 */
export function nextMusicAudible(input: {
  event: MusicAudibleEvent;
  readyState: number;
  paused: boolean;
}): boolean {
  switch (input.event) {
    case "srcswap":
    case "error":
    case "pause":
    case "ended":
      return false;
    case "waiting":
      // Stall with no data (cold yt-dlp). Keep audible if we already have frames.
      return (
        input.readyState >= MEDIA_HAVE_CURRENT_DATA && !input.paused
      );
    case "timeupdate":
    case "canplay":
      return input.readyState >= MEDIA_HAVE_CURRENT_DATA && !input.paused;
    default:
      return false;
  }
}
