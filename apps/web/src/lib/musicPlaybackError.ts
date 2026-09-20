/** Auto-retry the same track once, then skip. Avoids waiting through many 45s resolves. */
export const MAX_AUDIO_RETRIES = 1;
export const MAX_CONSECUTIVE_FAIL_SKIPS = 5;
export const AUDIO_RETRY_DELAY_MS = 1200;
/** Client watchdog for hung yt-dlp TTFB. Not the server resolve limit (45s). */
export const AUDIO_STALL_TIMEOUT_MS = 10_000;
/** HTMLMediaElement.HAVE_CURRENT_DATA — enough buffered to produce sound. */
export const AUDIO_HAVE_CURRENT_DATA = 2;
export const PREVIOUS_RESTART_AFTER_SEC = 3;

export type AudioErrorAction = "retry" | "skip" | "stop";
export type AudioStallAction = AudioErrorAction | "wait";

export function decideAudioErrorAction(input: {
  playIntent: boolean;
  retryCount: number;
  consecutiveFailSkips: number;
  hasNextTrack: boolean;
  maxRetries?: number;
  maxConsecutiveSkips?: number;
}): AudioErrorAction {
  if (!input.playIntent) {
    return "stop";
  }
  const maxRetries = input.maxRetries ?? MAX_AUDIO_RETRIES;
  if (input.retryCount < maxRetries) {
    return "retry";
  }
  const maxSkips = input.maxConsecutiveSkips ?? MAX_CONSECUTIVE_FAIL_SKIPS;
  if (
    input.hasNextTrack &&
    input.consecutiveFailSkips < maxSkips
  ) {
    return "skip";
  }
  return "stop";
}

/**
 * Stall watchdog: same retry/skip/stop policy as media errors, gated on
 * audible progress and elapsed time since load. Returns "wait" until the
 * timeout so the 10s budget is not buried only in a setTimeout.
 */
export function decideAudioStallAction(input: {
  playIntent: boolean;
  audible: boolean;
  msSinceLoad: number;
  retryCount: number;
  consecutiveFailSkips: number;
  hasNextTrack: boolean;
  stallTimeoutMs?: number;
  maxRetries?: number;
  maxConsecutiveSkips?: number;
}): AudioStallAction {
  if (input.audible) {
    return "wait";
  }
  const timeout = input.stallTimeoutMs ?? AUDIO_STALL_TIMEOUT_MS;
  if (input.msSinceLoad < timeout) {
    return "wait";
  }
  return decideAudioErrorAction(input);
}

/** Restart-current on Previous only when audio is actually flowing. */
export function shouldRestartCurrentTrack(input: {
  audible: boolean;
  currentTimeSec: number;
  restartAfterSec?: number;
}): boolean {
  const restartAfter = input.restartAfterSec ?? PREVIOUS_RESTART_AFTER_SEC;
  return input.audible && input.currentTimeSec > restartAfter;
}

export function isAudibleAudioElement(input: {
  readyState: number;
  paused: boolean;
}): boolean {
  return (
    !input.paused && input.readyState >= AUDIO_HAVE_CURRENT_DATA
  );
}
