#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STREAM_DIR="${ROOT}/stream-server"
ENV_FILE="${STREAM_DIR}/.env"

if [[ ! -d "${STREAM_DIR}" ]]; then
  echo "Missing stream-server directory at ${STREAM_DIR}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy stream-server/.env.example and fill in production values." >&2
  exit 1
fi

cd "${STREAM_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run the stream server." >&2
  exit 1
fi

COMPOSE=(docker compose)
if ! "${COMPOSE[@]}" version >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
fi

echo "Building and restarting stream-server..."
"${COMPOSE[@]}" build --pull
"${COMPOSE[@]}" up -d --remove-orphans
"${COMPOSE[@]}" ps

echo "stream-server deploy complete."
