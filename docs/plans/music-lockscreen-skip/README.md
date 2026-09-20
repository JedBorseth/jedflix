# Music lock-screen skip — execution index

Phone lock-screen next/previous on uncached YouTube audio fails silently while the Now Playing clock still counts. Cached tracks play. These four plans fix that. **One plan per thread. Implement only the attached plan. Do not edit the plan file.**

## Prompt to paste

```
Implement only the attached plan. Do not edit the plan file. Do not implement sibling plans in docs/plans/music-lockscreen-skip/. Follow its in-scope / out-of-scope and iOS constraints. Verify with tests (and browser if the plan’s surface is UI).
```

## Thread order

| Plan | Can start | Blocked by | Surface |
| --- | --- | --- | --- |
| [01 — Honest lock-screen clock](./01-honest-lock-screen-clock.md) | Immediately | None | Web player + Media Session |
| [02 — Cancel abandoned yt-dlp](./02-cancel-abandoned-ytdlp.md) | Immediately (parallel with 01) | None | Go YouTube resolver |
| [03 — Prefetch priority lane](./03-prefetch-priority-lane.md) | After 01 and 02 land | 01, 02 | Resolver + prefetch client |
| [04 — Stall timeout, retry, skip](./04-stall-timeout-retry-skip.md) | After 01 lands | 01 | Web player |

01 and 02 do not share files. 03 and 04 both touch the music player; wait for 01 so `playing` means “audio is flowing,” and wait for 02 so cancelled prefetch HEADs actually free yt-dlp slots.

## Target UX (all four together)

- Next/previous changes title/artwork immediately.
- Clock stays at `0:00` until audio is actually coming out.
- Mash skip only resolves the track you landed on.
- Prefetch warms previous + next without starving playback.
- A hung uncached load retries once, then skips (capped).
