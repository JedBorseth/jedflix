#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAN=("${ROOT}/scripts/deploy-compose.sh" --plan)

assert_contains() {
  local haystack="$1" needle="$2"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    echo "expected to find ${needle} in:" >&2
    echo "${haystack}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2"
  if [[ "${haystack}" == *"${needle}"* ]]; then
    echo "did not expect ${needle} in:" >&2
    echo "${haystack}" >&2
    exit 1
  fi
}

book="$("${PLAN[@]}" apps/backend/internal/realdebrid/bookfiles.go .github/workflows/deploy-production.yml)"
assert_contains "${book}" "BUILD=backend"
assert_contains "${book}" "CADDY=1"
assert_not_contains "${book}" "music-ai"
assert_not_contains "${book}" "music-embed"
assert_not_contains "${book}" "musicbrainz-db"

music_ai="$("${PLAN[@]}" apps/music-ai/app.py)"
assert_contains "${music_ai}" "BUILD=music-ai"
assert_not_contains "${music_ai}" "backend"

embed="$("${PLAN[@]}" apps/backend/internal/musicbrainz/client.go)"
assert_contains "${embed}" "backend"
assert_contains "${embed}" "music-embed"

pg="$("${PLAN[@]}" deploy/musicbrainz/Dockerfile.postgres)"
assert_contains "${pg}" "BUILD=musicbrainz-db"

compose="$("${PLAN[@]}" docker-compose.yml)"
assert_contains "${compose}" "BUILD="
assert_contains "${compose}" "SYNC_COMPOSE=1"
assert_not_contains "${compose}" "music-ai"

web="$("${PLAN[@]}" apps/web/src/pages/ListenPage.tsx)"
assert_contains "${web}" "BUILD=frontend"

echo "deploy-compose plan tests passed"
