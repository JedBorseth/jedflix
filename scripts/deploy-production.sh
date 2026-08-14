#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-${ROOT}/.env}"

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-production.sh [--pull] [--full]

Deploy JedFlix on this server using Docker Compose.

Environment:
  DEPLOY_ENV_FILE   Path to env file (default: .env in repo root)

Requires:
  docker compose
  git checkout at the repo root
  .env with DOMAIN, Convex URLs, TMDB, and backend secrets
EOF
}

PULL=false
FULL_STACK=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull)
      PULL=true
      shift
      ;;
    --full)
      FULL_STACK=true
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

DATA_ROOT="${JEDFLIX_DATA_ROOT:-/mnt/disk1/jedflix}"
mkdir -p "${DATA_ROOT}/musicbrainz"/{pgdata,meili,dumps,replication} \
  "${DATA_ROOT}/music-artwork"/{by-mbid,by-hash,missing} || true

if [[ "${PULL}" == "true" ]]; then
  DEPLOY_SINCE="$(git rev-parse HEAD)"
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
chmod +x scripts/deploy-compose.sh
if [[ "${FULL_STACK:-false}" == "true" ]]; then
  ./scripts/deploy-compose.sh --full
elif [[ "${PULL}" == "true" ]]; then
  ./scripts/deploy-compose.sh --since "${DEPLOY_SINCE}"
else
  docker compose up -d --build --remove-orphans
  docker compose up -d --force-recreate --no-deps caddy
  docker compose ps
fi

echo "Production deploy finished."
