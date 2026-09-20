# 04: Stall timeout, retry, skip

**What to build:** If the user wants a track to play and **no audio timeupdate arrives within ~10 seconds**, retry that track once (`fresh=1`), then skip to the next. Cap consecutive auto-skips. While the current load is not audible, **Previous** goes to the previous track (never “restart this silent song”).

**Blocked by:** 01 (honest clock). Needs audible vs `playIntent` so the timer measures “no sound yet,” not “play() was called.”

**Status:** ready-for-agent

**Sibling plans (out of scope):** 01 Media Session mapping (consume it), 02 yt-dlp cancel, 03 prefetch lane. Do not implement those here.

## Problem

Uncached lock-screen loads often never fire `error` while Safari is backgrounded; the GET hangs on yt-dlp TTFB. Existing logic only retries/skips on the audio `error` event (`decideAudioErrorAction`: 1 retry, then skip, stop after 5 consecutive skips). Hung loads sit forever. `previous()` treats `audio.currentTime > 3` as “restart current”; a stuck or interpolated position can restart a silent track instead of going back.

## User stories

1. As a listener who skipped onto a cold track on the lock screen, I want it to start, retry once, or move on — not sit silent with a frozen or fake clock.
2. As a listener hitting previous during a load that never started, I want the previous song, not a restart of silence.
3. As a listener in a bad-network stretch, I want auto-skip to stop after a handful of failures so the queue does not walk itself.

## Implementation decisions

- Add a **stall timer** in the music player: starts whenever `loadAndPlay` sets `playIntent` for a generation; clears on first audible `timeupdate`/`canplay` with data, on user pause, on clear, or when generation changes.
- Timeout budget: **~10s** with no audible progress (named constant). yt-dlp may take up to 45s; 10s is the client watchdog for “iOS will not wait,” not the server resolve limit.
- On stall, reuse `decideAudioErrorAction` (do not fork a second policy): first stall → `loadAndPlay(..., { retrying: true })` which already sends `fresh=1`; second stall or post-retry failure → `next()`; after `MAX_CONSECUTIVE_FAIL_SKIPS` → stop (keep `playIntent` so lock-screen Play can still reload, same as today’s `onError` stop path).
- Successful audible start resets `consecutiveFailSkip`.
- **Previous:** if the current track is **not audible**, always go to the previous queue item (or no-op at index 0). The `currentTime > 3` restart applies only when audio is actually flowing.
- Do not debounce or delay the `play()` call that belongs in the skip gesture; the timer runs **after** that `play()`.
- Put timeout constants next to `AUDIO_RETRY_DELAY_MS` in `musicPlaybackError.ts` and unit-test “stall with no timeupdate” via a helper (`shouldStallRetry`, or `decideAudioErrorAction` plus a `msSinceLoad` gate) so the 10s policy is not buried only in a `setTimeout` inside the provider.

## Starting points

- `apps/web/src/lib/musicPlaybackError.ts` and `musicPlaybackError.test.ts`
- `apps/web/src/components/player/music/MusicPlayerContext.tsx` — `loadAndPlay`, `previous`, `onError`, `onTimeUpdate`, existing `retryTimerRef` / `errorRetryRef` / `consecutiveFailSkipRef`
- 01’s audible flag — this plan must use it, not re-derive “playing” from `onPlay`

## Testing

- Policy tests: no audible progress for timeout + retryCount 0 → retry; after retry still silent → skip if there is a next track; after max consecutive skips → stop; user pause (`playIntent` false) → stop, no skip.
- Previous: not audible + `currentTime` 0 or > 3 → previous index; audible + `currentTime > 3` → seek to 0.
- Keep existing `onError` retry/skip tests in spirit; stall and media error should share one limiter so a stall retry plus an error retry cannot loop forever (same `errorRetryRef` / generation).

## Out of scope

- Media Session position interpolation (01)
- Server cancel / prefetch slots (02 / 03)
- Changing yt-dlp `ResolveTimeout` (45s)
- Showing a lock-screen spinner (the OS has none); frozen 0:00 from 01 is the loading affordance

## Acceptance criteria

- [ ] `playIntent` and no audible progress for ~10s → one `fresh` retry, then skip if another track exists.
- [ ] Consecutive auto-skips stop at the existing cap; lock-screen Play can still reload.
- [ ] First audible `timeupdate` cancels the stall timer and resets the consecutive-skip count.
- [ ] Previous during a non-audible load goes to the previous track.
- [ ] Policy is unit-tested; `play()` remains in the Media Session / user-gesture turn.
