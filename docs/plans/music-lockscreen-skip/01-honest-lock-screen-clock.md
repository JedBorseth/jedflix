# 01: Honest lock-screen clock

**What to build:** Skipping to a song on the iPhone lock screen (or in-app) must show the new title immediately, keep next/previous as track skip (not ±10s seek), and **leave the elapsed clock at 0:00 until audio is actually flowing**. The lock screen must not interpolate a playing position for a track that has not produced sound.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Sibling plans (out of scope):** 02 cancel yt-dlp, 03 prefetch lane, 04 stall timeout. Do not implement those here.

## Problem

Music audio is an HTML `<audio>` element whose `src` is `/backend/api/v1/youtube/audio`. Cache misses block on yt-dlp (up to 45s). Lock-screen next/previous calls `loadAndPlay` with `immediatePlay: true`, then:

1. `onPlay` sets `playing = true` before any bytes arrive.
2. `onPause` ignores pause while `playIntent` is set, so Media Session stays `"playing"`.
3. `useMediaSession` publishes catalog duration, position `0`, `playbackRate: 1`.

iOS then interpolates elapsed time with no audio. Cached tracks hide this because TTFB is fast. This plan fixes the lying clock, not yt-dlp throughput.

## User stories

1. As a listener on the lock screen, I want the new song’s title as soon as I hit next, so I know which track I landed on.
2. As a listener on the lock screen, I want the time to stay at 0:00 until I hear audio, so a cold resolve does not look like it is playing.
3. As a listener, I want lock-screen buttons to stay next/previous track, not skip ±10 seconds.
4. As a listener who opens the app during a cold resolve, I want the in-app bar to match the lock screen (loading, clock frozen), not a running seek bar.

## Implementation decisions

- Keep **`playIntent`** as “the user wants audio.” Keep calling `play()` inside the Media Session / click turn (`immediatePlay: true`). That activation token is required on iOS.
- Introduce a separate **audible** flag (name as you like: `audible`, `hasAudio`, `isStreaming`). It becomes true only after the element has data and a real `timeupdate` (or `canplay` with `readyState >= HAVE_CURRENT_DATA` and `!paused`). It becomes false on src swap, `waiting` without data, `error`, pause, or `ended`.
- Media Session **`playbackState`** is `"playing"` only when audible. While resolving with `playIntent`, use `"paused"` (clock must not interpolate). Re-bind `previoustrack` / `nexttrack` and keep `seekbackward` / `seekforward` / `seekto` as `null` on every skip (`preferTrackSkip` + `actionHandlerKey` already exist).
- Publish **`setPositionState`** with `playbackRate: 1` only when audible. While resolving: position `0`, or omit position updates rather than publishing a 1x playing state. `playbackRate: 0` is invalid here (the helper already coerces it to 1).
- In-app `playing` / seek bar / time label follow the audible flag, not the early `play` event.
- `loading` stays true until audible or error. `onPlay` must not clear loading by itself.
- Extract a pure helper for the UI/session mapping (`playIntent` + element facts → `{ playing, loading, playbackState, publishPosition }`) and unit-test it. Prior art: `apps/web/src/lib/mediaSession.ts` and `musicPlaybackError.ts`.

## iOS constraints (required)

- Call `play()` in the same turn as the lock-screen next/previous handler.
- Keep `preferTrackSkip` and re-assert next/previous when the current track id changes and on `visibilitychange` / `pageshow`.
- Changing `src` still fires `pause`; that must not look like a user pause while a new load is in flight, but it also must not keep Media Session in `"playing"` at 1x with no data.

## Starting points

- `apps/web/src/components/player/music/MusicPlayerContext.tsx` — `loadAndPlay`, `onPlay` / `onPause` / `onWaiting` / `onTimeUpdate`, `useMediaSession` wiring
- `apps/web/src/hooks/useMediaSession.ts`
- `apps/web/src/lib/mediaSession.ts` — `setMediaSessionPositionState`, `setMediaSessionPlaybackState`
- `apps/web/src/lib/mediaSession.test.ts`
- `apps/web/src/components/player/music/MusicPlayerBar.tsx` — consumes `playing` / `currentTime` / `duration` / `loading`

## Testing

- Unit-test the helper: playIntent + no data → paused/loading, clock not published as 1x playing; first timeupdate with data → playing; src swap resets to not audible; user pause (`playIntent` false) → paused.
- Extend Media Session tests so position publish with `playbackRate: 1` is not implied for a paused/loading state.
- Existing `playMediaElement` abort vs error tests still pass (`aborted` is not “now playing”).

## Out of scope

- yt-dlp cancel, slot priority, prefetch URL flags (02 / 03)
- Stall timer, auto-skip on hang (04)
- Debouncing `play()` after the gesture
- Playing the previous song under the new title while the next src resolves

## Acceptance criteria

- [ ] Lock-screen / in-app elapsed time does not advance until the audio element is producing `timeupdate` with data.
- [ ] Next/previous still updates metadata immediately and still calls `play()` in that user/Media Session turn.
- [ ] Lock-screen controls remain next/previous track (`preferTrackSkip`), not ±10s seek.
- [ ] Cached tracks still start and show a moving clock once audio flows.
- [ ] Helper tests cover playIntent vs audible vs paused vs src-swap.
