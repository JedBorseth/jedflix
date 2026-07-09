FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/stream-client/package.json ./packages/stream-client/
COPY packages/tmdb/package.json ./packages/tmdb/
RUN bun install --frozen-lockfile

COPY apps/web ./apps/web
COPY packages ./packages
COPY convex ./convex

WORKDIR /app/apps/web

ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_TMDB_API_KEY
ARG VITE_STREAM_API_URL=/stream-api
ARG VITE_STREAM_API_KEY=

ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL
ENV VITE_TMDB_API_KEY=$VITE_TMDB_API_KEY
ENV VITE_STREAM_API_URL=$VITE_STREAM_API_URL
ENV VITE_STREAM_API_KEY=$VITE_STREAM_API_KEY

RUN bun run build

FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
