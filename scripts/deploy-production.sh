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

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

DATA_ROOT="${JEDFLIX_DATA_ROOT:-/mnt/disk1/jedflix}"
mkdir -p "${DATA_ROOT}/musicbrainz"/{pgdata,dumps,replication} \
  "${DATA_ROOT}/music-artwork"/{by-mbid,by-hash,missing} || true

MARKER="${ROOT}/.git/jedflix-last-deployed"
if [[ "${PULL}" == "true" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Refusing to reset: tracked files have local changes." >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
  DEPLOY_SINCE="$(cat "${MARKER}" 2>/dev/null || git rev-parse HEAD)"
  git fetch origin main
  git reset --hard origin/main
fi

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

echo "Checking backend health..."
for _ in $(seq 1 30); do
  if docker compose exec -T backend wget -qO- http://127.0.0.1:8080/health >/dev/null; then
    git rev-parse HEAD > "${MARKER}"
    echo "Production deploy finished."
    exit 0
  fi
  sleep 2
done
echo "Backend failed its health check; not recording this deploy." >&2
docker compose logs --tail=50 backend >&2 || true
exit 1
