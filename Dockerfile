FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json postcss.config.js tailwind.config.js components.json ./
COPY public ./public
COPY src ./src
COPY convex ./convex

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
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
