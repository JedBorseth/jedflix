# 02: Cancel abandoned yt-dlp work

**What to build:** When the client aborts a YouTube audio request because the user skipped away, and **no other waiter** still wants that same cache key, the backend must stop that yt-dlp process and free a concurrency slot. Mash-skip must not leave three yt-dlp jobs running for songs that will never play.

**Blocked by:** None (can start immediately; parallel with 01).

**Status:** ready-for-agent

**Sibling plans (out of scope):** 01 lock-screen clock, 03 prefetch priority, 04 stall timeout. Do not implement those here.

## Problem

`Resolve` uses `singleflight` and runs yt-dlp on `context.Background()` with a 45s timeout so “a cancelled HEAD does not kill an in-flight GET.” That is correct for HEAD+GET of the **same** track. It is wrong for skip: each skipped song’s GET is aborted, but yt-dlp keeps going and occupies one of `MAX_CONCURRENT_YOUTUBE` (default 3) slots. The track the user landed on waits behind work they already abandoned.

## User stories

1. As a listener mashing next on the lock screen, I want only the song I landed on to occupy a yt-dlp slot, so it can start as soon as YouTube allows.
2. As a listener whose current song is still resolving, I want a metadata HEAD for **that same** song to share the in-flight resolve rather than cancel it.
3. As the server, I want abandoned yt-dlp processes to exit, so CPU and the 3-slot cap stay available.

## Implementation decisions

- Replace “always detach from the caller” with **waiter refcount per cache key**.
- Each `Resolve(ctx, req)` registers as a waiter on that key and waits on the caller `ctx` **and** the shared resolve.
- The shared resolve context is: timeout `youtube.ResolveTimeout` (45s) **plus** cancel when the waiter count hits zero.
- **HEAD cancelled, GET still waiting on the same key:** waiter count stays > 0; yt-dlp continues. This preserves the original HEAD/GET comment.
- **GET cancelled and no other waiters:** cancel the shared context; `exec.CommandContext` and `acquire` must unblock and `release` the slot.
- Cache writes still happen if the process finishes before cancel. A later request for that key is a cache hit.
- `singleflight.Group` does not model waiter cancel. A small in-flight map (key → waiters, result, cancel) is the right shape; keep duplicate-suppress for concurrent same-key resolves.
- `acquire(ctx)` already returns on `ctx.Done()`. Cancelled resolves must go through that path so slots cannot leak. Extend `limit_test.go` plus new waiter tests; inject a fake long `resolveUncached` (or a test hook) so tests do not shell out to yt-dlp.

## Starting points

- `apps/backend/internal/youtube/resolver.go` — `Resolve`, `inflight`, `resolveUncached`, `acquire` / `release`
- `apps/backend/internal/youtube/limit_test.go`
- `apps/backend/internal/youtube/resolver_test.go` (scoring tests stay; add inflight/cancel tests)
- `apps/backend/internal/api/server.go` — `handleYouTubeAudio` already passes `r.Context()`; aborting the HTTP request must reach waiter teardown
- `apps/backend/internal/config/config.go` — `MaxConcurrentYoutube` default 3 (do not retune the cap in this plan)

## Testing

Good tests observe **external behavior** of `Resolve`, not map internals:

- Two waiters, same key: one `resolveUncached` (or one fake job).
- Cancel waiter A while B remains: job continues; B gets the result.
- Cancel the last waiter: job context ends; a slot `acquire` that was blocked then succeeds.
- After a completed resolve, a new `Resolve` is a cache hit and does not start another job.

## Out of scope

- Prefetch vs playback slot reservation (03)
- Client Media Session / stall timer (01 / 04)
- Changing format selection, cookies, or search scoring
- Raising `MAX_CONCURRENT_YOUTUBE`

## Acceptance criteria

- [ ] Last waiter cancelled ⇒ yt-dlp work for that key is cancelled and its concurrency slot is released.
- [ ] A remaining waiter on the same key (GET vs cancelled HEAD) still receives the resolve result.
- [ ] Cache hits are unchanged (no yt-dlp, no slot).
- [ ] Tests cover shared in-flight, last-waiter cancel, and no slot leak — without requiring a real YouTube/yt-dlp run.
