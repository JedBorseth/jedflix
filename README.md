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
- Mock full-screen player (no real video streaming yet)
- Convex Auth sign-in with GitHub or Google
- My List for saved titles (signed-in users)
- Star ratings and public reviews on title pages
- Continue Watching and Recently Watched rows on the home page
- Watch progress saved while signed in

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

- Playback is simulated UI only — no Mux or file storage yet
- Use `bunx convex deploy` (without `--bun`) for CI/production deploys
- Convex functions run in Convex's runtime; Bun is used locally for tooling
