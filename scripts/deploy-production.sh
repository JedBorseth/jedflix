#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-${ROOT}/deploy/.env.production}"
WEB_ROOT="${PROD_WEB_ROOT:-/var/www/jedflix}"

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-production.sh [--frontend-only | --stream-only]

Deploy JedFlix production services on this server.

Environment:
  DEPLOY_ENV_FILE   Path to production env file (default: deploy/.env.production)
  PROD_WEB_ROOT     Static frontend directory (default: /var/www/jedflix)

The env file should define build/runtime values such as:
  CONVEX_DEPLOY_KEY
  VITE_TMDB_API_KEY
  VITE_STREAM_API_URL
  VITE_STREAM_API_KEY

Stream-server secrets live separately in stream-server/.env.
EOF
}

MODE="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --frontend-only)
      MODE="frontend"
      shift
      ;;
    --stream-only)
      MODE="stream"
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

if [[ "${MODE}" != "stream" ]]; then
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}. Copy deploy/env.production.example first." >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a

  if [[ -z "${VITE_TMDB_API_KEY:-}" ]]; then
    echo "VITE_TMDB_API_KEY must be set in ${ENV_FILE}" >&2
    exit 1
  fi

  cd "${ROOT}"

  echo "Installing frontend dependencies..."
  if command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile
    BUILD_CMD=(bun run build)
    CONVEX_CMD=(bunx convex deploy --cmd 'bun run build' --cmd-url-env-var-name VITE_CONVEX_URL)
  else
    npm ci
    BUILD_CMD=(npm run build)
    CONVEX_CMD=(npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL)
  fi

  if [[ -n "${CONVEX_DEPLOY_KEY:-}" ]]; then
    echo "Deploying Convex..."
    "${CONVEX_CMD[@]}"
  else
    echo "CONVEX_DEPLOY_KEY not set; building frontend without deploying Convex."
    "${BUILD_CMD[@]}"
  fi

  echo "Publishing frontend to ${WEB_ROOT}..."
  mkdir -p "${WEB_ROOT}"
  rsync -av --delete "${ROOT}/dist/" "${WEB_ROOT}/"
  echo "Frontend deploy complete."
fi

if [[ "${MODE}" != "frontend" ]]; then
  "${ROOT}/scripts/deploy-stream-server.sh"
fi

echo "Production deploy finished."
