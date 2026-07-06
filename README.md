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
| `bun run dev` | Start Vite frontend and Convex backend |
| `bun run build` | Type-check and build for production |
| `bun test` | Run component tests with Bun |
| `bun run lint` | Type-check and lint |

## Features

- Netflix-style browse page with hero banner and genre rows
- Movie detail pages with synopsis and metadata
- Stremio-style full-screen player with Real Debrid streaming (via Go stream-server)
- Direct or proxied stream delivery toggle in the navbar
- TV season/episode picker and playback routes
- Convex Auth sign-in with GitHub or Google
- My List for saved titles (signed-in users)
- Star ratings and public reviews on title pages
- Continue Watching and Recently Watched rows on the home page
- Watch progress saved while signed in

## Streaming

Playback uses Torrentio for source discovery and Real Debrid for resolving playable links.
The app supports two delivery modes:

- **Direct**: the browser calls the Real Debrid API with the API key saved in Settings and plays the RD CDN URL directly.
- **Proxy**: the Go service resolves the stream using the user's saved Real Debrid API key when present, or `REALDEBRID_TOKEN` from the server environment as a fallback, then byte-serves playback through `/stream-api`.

The Go service in [`stream-server/`](stream-server/) still:

1. Searches Torrentio for magnets by IMDb ID
2. Filters by size (default 50GB max), seeders (default min 3), and known Real Debrid infringing filename patterns
3. Checks Real Debrid instant availability for cache badges and ranking
4. Resolves proxied streams and signs proxy URLs

Configure the frontend:

```bash
# .env.local
VITE_STREAM_API_URL=/stream-api
VITE_STREAM_API_KEY=
```

Configure the stream server (see [`stream-server/.env.example`](stream-server/.env.example)):

```bash
REALDEBRID_TOKEN=your_token
PROXY_SIGNING_SECRET=change-me
CORS_ORIGINS=http://localhost:5173
RD_BLOCKED_FILENAME_REGEX=web-dl|webrip|bdrip|hdrip|dvdrip|BluRay\.x264|HDTV\.x264|HDTV\.XviD|WEB\.x264|WEB\.h264
```

Run locally:

```bash
bun run dev
```

This starts Vite, Convex, and the Go stream-server.

Player UI components under `src/components/player/stremio/` are derived from [Stremio Web](https://github.com/Stremio/stremio-web) (GPL-2.0).

## Project structure

```
convex/           Convex schema, queries, mutations, auth
src/
  components/     UI components (browse, player, layout, auth)
  pages/          Route pages
  lib/            Shared TypeScript types
tests/            Bun test preload setup
```

## Notes

- Direct streaming requires a Real Debrid API key saved in Settings
- Proxy streaming can use a saved user Real Debrid API key or `REALDEBRID_TOKEN` on the Go stream-server
- Player components are GPL-2.0 derived from Stremio Web
- Use `bunx convex deploy` (without `--bun`) for CI/production deploys
- Convex functions run in Convex's runtime; Bun is used locally for tooling

## Production deployment

Production runs on a single server with **Docker Compose**: Caddy (TLS + routing), a built frontend container, and the Go stream-server.

Recommended CD: **GitHub Actions on every push to `main`**.

| Component | Where it runs | How it deploys |
|-----------|---------------|----------------|
| Convex backend | Convex Cloud | `bunx convex deploy` in CI |
| React frontend | Docker `frontend` service | Rebuilt on the server from repo `Dockerfile` |
| Go stream-server | Docker `stream-server` service | Rebuilt on the server from `stream-server/` |
| TLS / routing | Docker `caddy` service | Uses `deploy/Caddyfile` |

### Server layout

Default path on the production box:

```text
/home/jedborseth/jedflix
  .env                 # production secrets (not in git)
  docker-compose.yml
  Dockerfile
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
