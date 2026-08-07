<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Learned User Preferences

- Complete tasks fully before stopping; verify fixes with tests or a running dev server when relevant (including after feature work when requested).
- Commit and push completed work directly to `main`; do not open pull requests unless explicitly asked.
- Do not store movie/show/book catalog data in Convex; use TMDB and Open Library for metadata and keep only user-specific data (my list, ratings, watch history).
- When no streams pass device compatibility filters, offer an option to remove filters and show all streams.
- Direct Real Debrid streams should not route through the Go backend proxy.
- Video player UI should mirror Stremio web player patterns with manual stream selection, not auto-pick.
- When implementing attached plans, do not edit the plan file; use existing todos and mark them in progress.
- Mobile UX: bottom nav, fade-only view transitions (no scroll preservation), search inputs sized to prevent iOS Safari zoom, skeleton loaders to reduce layout shift.
- View transitions for poster expand with fade fallback; avoid duplicate view-transition-name bugs on chained navigations.
- Prefer GitHub Actions CI/CD to deploy frontend, Go backend, and Convex on push to main.
- Music artist pages should show Popular top tracks and full discography (Spotify-like); iOS music lock-screen controls should be next/previous track, not ±10s seek; keep Spotify track duration rather than overwriting with yt-dlp/YouTube stream length.
- Mobile music player: keep the bar flush with the bottom nav; do not use full-overlay touch capture that blocks taps on controls; queue UI should show the current track at the top (hide prior tracks in the UI, keep them for previous).
- Party mode: JedFlix↔JedFlix syncs track, play/pause, and position (≈5s grace); Spotify follow mirrors Spotify→JedFlix for track/position, with JedFlix→Spotify pause/play only (never change Spotify’s track or seek).

## Learned Workspace Facts

- JedFlix is a Netflix-style streaming app for movies, TV, audiobooks, and music: React + TypeScript + Vite frontend, Convex backend, Bun for package manager and tests.
- Production URL is https://borseth.ddns.net; GitHub repo is https://github.com/JedBorseth/jedflix; server deploy path is ~/jedflix on borseth.ddns.net (Debian); production deploys via GitHub Actions on push to main.
- Production Docker stack: Caddy (HTTPS, basic auth, reverse proxy) → frontend (nginx SPA) + Go backend at /backend.
- Convex production deployment uses canny-bat-352.convex.cloud (distinct from local dev deployment).
- Go backend discovers magnets via Torrentio, resolves Real Debrid streams server-side for the web client, proxies Open Library with a 12-hour in-memory cache, serves Spotify music metadata, resolves music audio via yt-dlp (prefer m4a/mp3/aac over webm/opus for browser/Safari), and applies configurable size/seeders limits.
- Video playback uses @stremio/stremio-video; production builds require vite-plugin-vtt-js.ts to fix vtt.js bundling; WatchPage is lazy-loaded.
- Auth is GitHub/Google OAuth via Convex Auth (email/password was replaced).
- Movie/TV metadata, cast, and search use TMDB; audiobook metadata uses Open Library (subjects plus trending/weekly for browse rows); music catalog uses Spotify via the Go backend (public artist API has no bios, monthly listeners, or verified badge; Dev Mode apps get 403 on public/editorial playlist tracks, so home shelves use search with playlist fallback).
- Navbar search on audiobook routes searches books and authors.
- Multi-file torrent resolution matches by media title and Torrentio fileIdx; packs without a title match are rejected.
- Party mode is Convex-synced multi-client music playback; Spotify OAuth needs `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` on the Convex deployment (same Spotify app as backend) plus redirect `https://<deployment>.convex.site/spotify/callback`.
- Local web stack: `bun run dev` runs Vite, Go backend, and Convex (Expo is `dev:mobile`); Vite loads `VITE_*` env from the monorepo root; local music playback needs yt-dlp installed.
