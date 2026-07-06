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

- Complete tasks fully before stopping; verify fixes with tests or a running dev server when relevant.
- Do not store movie/show catalog data in Convex; use TMDB for metadata and keep only user-specific data (my list, ratings, watch history).
- Direct Real Debrid streams should not route through the Go stream-server proxy.
- Video player UI should mirror Stremio web player patterns with manual stream selection, not auto-pick.
- When implementing attached plans, do not edit the plan file; use existing todos and mark them in progress.
- Mobile UX: bottom nav, fade-only view transitions (no scroll preservation), search inputs sized to prevent iOS Safari zoom, skeleton loaders to reduce layout shift.
- View transitions for poster expand with fade fallback; avoid duplicate view-transition-name bugs on chained navigations.
- Start a local dev/test server after feature work for manual verification when requested.
- Prefer GitHub Actions CI/CD to deploy frontend, Go backend, and Convex on push to main.

## Learned Workspace Facts

- JedFlix is a Netflix-style streaming app: React + TypeScript + Vite frontend, Convex backend, Bun for package manager and tests.
- Production URL is https://borseth.ddns.net; GitHub repo is https://github.com/JedBorseth/jedflix; server deploy path is ~/jedflix on borseth.ddns.net (Debian).
- Production Docker stack: Caddy (HTTPS, basic auth, reverse proxy) → frontend (nginx SPA) + Go stream-server at /stream-api.
- Convex production deployment uses canny-bat-352.convex.cloud (distinct from local dev deployment).
- Go stream-server discovers magnets via Torrentio and resolves streams through Real Debrid; size/seeders limits are configurable via env vars.
- Video playback uses @stremio/stremio-video; production builds require vite-plugin-vtt-js.ts to fix vtt.js bundling; WatchPage is lazy-loaded.
- Auth is GitHub/Google OAuth via Convex Auth (email/password was replaced).
- Movie metadata, cast, and search are powered by TMDB API.
- Production deploys via GitHub Actions workflow on push to main.
- Caddy HTTP Basic Auth protects the entire site (frontend and stream API).
