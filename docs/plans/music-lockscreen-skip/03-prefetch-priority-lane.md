# 03: Prefetch priority lane

**What to build:** Warm YouTube resolves for **previous 1 + next 2** queue tracks so lock-screen skip of nearby songs is a cache hit. Prefetch must not take the last yt-dlp slot from the track that is actually playing. Prefetch only while the current track is **audibly playing**, never from the early `play` event.

**Blocked by:** 01 (honest clock — `playing` / audible means audio is flowing) and 02 (cancelled HEADs must free slots).

**Status:** ready-for-agent

**Sibling plans (out of scope):** 01 Media Session clock, 02 waiter-cancel internals (consume them; do not rework them), 04 stall timeout. Do not implement those here.

## Problem

Prefetch HEADs the next two tracks only after `loading` is false, on a 400ms timer. `onPlay` currently clears `loading` before bytes arrive, so prefetch can start **during** the current resolve and consume yt-dlp slots. Rapid skip jumps past the warmed window. Previous is not prefetched. All resolves share one 3-slot semaphore.

After 01, audible `playing` is the right prefetch gate. After 02, aborting a prefetch HEAD actually stops yt-dlp.

## User stories

1. As a listener who started a song and locked the phone, I want next (and previous) to play immediately because those URLs were already resolved.
2. As a listener on a cold current track, I want yt-dlp to finish **this** song before warming neighbors.
3. As a listener who skipped past the warmed window, I accept that the new song may wait on yt-dlp (01 keeps the clock honest; 04 will skip hangs).

## Implementation decisions

### Backend — reserved playback slot

- Keep total cap at 3 (`MAX_CONCURRENT_YOUTUBE`).
- Reserve **1** slot for playback-priority resolves. Prefetch may use only the other slots.
- Playback-priority: audio `GET`, and the current-track metadata HEAD (same cache key as playback). Prefetch-priority: neighbor HEADs.
- Signal prefetch with an explicit query flag, e.g. `prefetch=1`. Default (missing flag) is playback-priority so an unchanged client cannot starve itself.
- Same cache key still shares one in-flight resolve (02). A prefetch HEAD that joins an in-flight playback resolve does not take a second slot.

### Frontend — when and what to prefetch

- Prefetch **previous one** (if any) and **next two**.
- Run prefetch only when the current track is audible / actually playing (the 01 meaning of `playing`), not when `loading` flipped false from `onPlay`.
- Current-track `fetchYoutubeAudioMetadata` HEAD stays **without** `prefetch=1` (same key as the GET).
- Neighbor HEADs set `prefetch=1` via `getYoutubeAudioUrl` / stream-client.
- Do not mark a track warmed unless the HEAD succeeded. 429 still stops the loop and unmarks so playback can use a slot.
- Failed or aborted HEADs remain eligible to prefetch later.

## Starting points

- `apps/backend/internal/youtube/resolver.go` — semaphore; add priority acquire
- `apps/backend/internal/api/server.go` — `handleYouTubeAudio` query flag
- `apps/backend/internal/youtube/limit_test.go` (and new priority tests)
- `packages/stream-client/src/client.ts` — `getYoutubeAudioUrl` params
- `apps/web/src/lib/spotify.ts` — re-export
- `apps/web/src/lib/youtubeAudioPrefetch.ts` — URL builder, `upcomingTracksForPrefetch` (extend or add previous)
- `apps/web/src/lib/youtubeAudioPrefetch.test.ts`
- `apps/web/src/components/player/music/MusicPlayerContext.tsx` — prefetch `useEffect` only

## Testing

- Resolver: with 1 reserved + 2 shared, three prefetch acquires cannot hold all three slots; a playback-priority acquire still succeeds while two prefetch jobs run (use a fake job, not yt-dlp).
- `getYoutubeAudioUrl({ prefetch: true })` includes `prefetch=1`; default playback URLs do not.
- Prefetch helper: HEAD only; previous+next selection; failed HEAD not in `warmed`; 429 stops and unmarks.
- Player: prefetch effect is gated on audible playing (test the gate function if you extract it; avoid a brittle full-provider mount if the repo does not already do that).

## Out of scope

- Changing Media Session position/playing (01)
- Rewriting waiter cancel (02)
- Stall timeout / auto-skip (04)
- Prefetching the whole queue or raising the yt-dlp cap
- Debouncing lock-screen `play()`

## Acceptance criteria

- [ ] While the current track is resolving, neighbor prefetch cannot take the last yt-dlp slot.
- [ ] After the current track is audibly playing, previous 1 and next 2 are HEADed with `prefetch=1`.
- [ ] Current-track GET/HEAD stay playback-priority and share one in-flight resolve.
- [ ] Unsuccessful HEADs are not treated as warmed.
- [ ] Tests cover slot reservation and prefetch URL/selection behavior.
