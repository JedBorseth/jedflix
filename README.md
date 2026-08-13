# JedFlix

A Netflix-style movie browsing app built with React, TypeScript, Vite, Convex, and Bun.

## Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router
- **Backend:** Convex (database, queries, mutations, auth)
- **Auth:** Convex Auth (GitHub and Google OAuth)
- **Tooling:** Bun (package manager, dev scripts, test runner)

## Prerequisites

- [Bun](https://bun.sh/)
- A [Convex](https://convex.dev/) account

## Getting started

```bash
bun install
bun run dev
```

The first run will prompt you to log in to Convex and create a deployment. This writes `.env.local` with `VITE_CONVEX_URL`.

Configure OAuth credentials for your Convex deployment:

```bash
node setup.mjs
```

Set `SITE_URL` to your frontend origin (for local dev):

```bash
bunx convex env set SITE_URL http://localhost:5173
```

OAuth callback URLs use your Convex site URL:

- GitHub: `https://<deployment>.convex.site/api/auth/callback/github`
- Google: `https://<deployment>.convex.site/api/auth/callback/google`

Seed demo movie data:

```bash
bunx convex run seed:seedMovies
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start web app, Convex backend, and Go backend |
| `bun run build` | Build all apps via Turborepo |
| `bun run test` | Run tests across the monorepo |
| `bun run lint` | Type-check and lint |

## Monorepo layout

```
apps/
  web/              Vite React frontend
  backend/    Go stream API (Torrentio + Real Debrid)
  mobile/           Expo React Native app (in progress)
packages/
  shared/           Shared types, validators, and helpers
  stream-client/    Stream API HTTP client
  tmdb/             TMDB API client
convex/             Convex backend (schema, auth, user data)
deploy/             Caddy, nginx, and MusicBrainz local-replica configs
```

## Local MusicBrainz (music catalog)

Production music search/detail uses a full MusicBrainz Postgres replica plus
pgvector embeddings and a Qwen reranker on `/mnt/disk1/jedflix/` (not the root
disk). Cover art is cached lazily under `/mnt/disk1/jedflix/music-artwork/`.

See [deploy/musicbrainz/README.md](deploy/musicbrainz/README.md) for import,
replication (`mbslave sync`), and embedding backfill.

## Features

- Netflix-style browse page with hero banner and genre rows
- Movie detail pages with synopsis and metadata
- Stremio-style full-screen player with Real Debrid streaming (via Go backend)
- Direct Real Debrid stream delivery (no proxy)
- TV season/episode picker and playback routes
- Audiobook and ebook streaming via AudiobookBay + Real Debrid (multi-file chapter/series packs)
- Convex Auth sign-in with GitHub or Google
- My List for saved titles (movies, shows, and books)
- Star ratings and public reviews on title pages
- Continue Watching / Continue Listening and Recently Watched rows on the home page
- Watch/listen progress saved while signed in

## Streaming

Playback uses Torrentio for source discovery and Real Debrid for resolving playable links.
The app supports two delivery modes:

Playback is **direct-only**: the browser (or mobile app) calls the Real Debrid API with the API key saved in Settings and plays the RD CDN URL directly.

The Go service in [`apps/backend/`](apps/backend/) still:

1. Searches Torrentio for magnets by IMDb ID
2. Filters by size (default 50GB max), seeders (default min 3), known Real Debrid infringing filename patterns, and browser-incompatible formats (MKV / Remux / Atmos / TrueHD / DTS) for in-app playback
3. Checks Real Debrid instant availability for cache badges and ranking

Configure the frontend:

```bash
# .env.local
VITE_BACKEND_URL=/backend
```

Configure the Go backend (see [`apps/backend/.env.example`](apps/backend/.env.example)):

```bash
TMDB_API_KEY=your_tmdb_key
CORS_ORIGINS=http://localhost:5173
LASTFM_API_KEY=  # optional — shelves, artist images, similar artists/tracks + Infinite Queue
# Spotify only needed on Convex for party mode / playlist sync (not for catalog)
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
ABB_USERNAME=  # optional AudiobookBay account (recommended)
ABB_PASSWORD=
RD_BLOCKED_FILENAME_REGEX=web-dl|webrip|bdrip|hdrip|dvdrip|BluRay\.x264|HDTV\.x264|HDTV\.XviD|WEB\.x264|WEB\.h264
```

Run locally:

```bash
bun run dev
```

This starts Vite, Convex, and the Go backend.

### Music playback (local dev)

Music catalog metadata comes from **MusicBrainz** (+ Cover Art Archive). Audio still uses **yt-dlp** on the backend (bundled in the production Docker image). Install it locally:

```bash
brew install yt-dlp
```

If YouTube blocks resolves from your IP, export a Netscape cookie file and set `YTDLP_COOKIES_FILE` in root `.env.local` (same as production).

## Project structure

See the monorepo layout above. Web UI components under `apps/web/src/components/player/stremio/` are derived from [Stremio Web](https://github.com/Stremio/stremio-web) (GPL-2.0).

Production Docker builds use repo root context with `apps/web/Dockerfile`.

## Notes

- Direct streaming requires a Real Debrid API key saved in Settings (bring-your-own; never stored as a shared server token)
- Movie/TV metadata uses TMDB via the Go backend (`TMDB_API_KEY` server-side only)
- Player components are GPL-2.0 derived from Stremio Web
- Use `bunx convex deploy` (without `--bun`) for CI/production deploys
- Convex functions run in Convex's runtime; Bun is used locally for tooling

## Production deployment

Production runs on a single server with **Docker Compose**: Caddy (TLS + routing), a built frontend container, and the Go backend.

Recommended CD: **GitHub Actions on every push to `main`**.

| Component | Where it runs | How it deploys |
|-----------|---------------|----------------|
| Convex backend | Convex Cloud | `bunx convex deploy` in CI |
| React frontend | Docker `frontend` service | Rebuilt on the server from `apps/web/Dockerfile` |
| Go backend | Docker `backend` service | Rebuilt on the server from `apps/backend/` |
| TLS / routing | Docker `caddy` service | Uses `deploy/Caddyfile` |

### Server layout

Default path on the production box:

```text
/home/jedborseth/jedflix
  .env                 # production secrets (not in git)
  docker-compose.yml
  apps/web/Dockerfile
  deploy/Caddyfile
```

Copy the example env file once and fill in real values:

```bash
cp .env.example .env
docker compose up -d --build
```

Set Convex production auth URL once:

```bash
bunx convex env set SITE_URL https://borseth.ddns.net
```

### GitHub Actions setup

Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `PROD_SSH_HOST` | `borseth.ddns.net` |
| `PROD_SSH_USER` | `jedborseth` |
| `PROD_SSH_KEY` | Private SSH deploy key (see below) |
| `CONVEX_DEPLOY_KEY` | Production deploy key from the Convex dashboard |

Optional repository variable:

| Variable | Default |
|----------|---------|
| `PROD_APP_DIR` | `/home/jedborseth/jedflix` |

On push to `main`, CI will:

1. Run tests
2. Deploy Convex (when `CONVEX_DEPLOY_KEY` is set)
3. SSH to the server, `git pull`, and run `docker compose up -d --build`

Frontend build args (`VITE_*`, Real Debrid, etc.) stay in the server `.env` file and are **not** stored in GitHub.

### Manual deploy on the server

```bash
cd ~/jedflix
./scripts/deploy-production.sh --pull
```

Workflow file: [`.github/workflows/deploy-production.yml`](.github/workflows/deploy-production.yml)
