#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-${ROOT}/.env}"

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-production.sh [--pull]

Deploy JedFlix on this server using Docker Compose.

Environment:
  DEPLOY_ENV_FILE   Path to env file (default: .env in repo root)

Requires:
  docker compose
  git checkout at the repo root
  .env with DOMAIN, Convex URLs, TMDB, and stream-server secrets
EOF
}

PULL=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull)
      PULL=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.example and fill in production values." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required." >&2
  exit 1
fi

cd "${ROOT}"

if [[ "${PULL}" == "true" ]]; then
  git fetch origin main
  git reset --hard origin/main
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -n "${CONVEX_DEPLOY_KEY:-}" ]] && command -v bun >/dev/null 2>&1; then
  echo "Deploying Convex..."
  bunx convex deploy
elif [[ -n "${CONVEX_DEPLOY_KEY:-}" ]] && command -v npx >/dev/null 2>&1; then
  echo "Deploying Convex..."
  npx convex deploy
fi

echo "Building and restarting Docker stack..."
docker compose up -d --build
docker compose ps

echo "Production deploy finished."
