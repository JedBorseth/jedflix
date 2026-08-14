/** Auto-retry the same track once, then skip. Avoids waiting through many 45s resolves. */
export const MAX_AUDIO_RETRIES = 1;
export const MAX_CONSECUTIVE_FAIL_SKIPS = 5;
export const AUDIO_RETRY_DELAY_MS = 1200;

export type AudioErrorAction = "retry" | "skip" | "stop";

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
