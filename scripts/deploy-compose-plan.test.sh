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

# Repeated --since deploys the union of both diffs; unknown SHAs fall back
# to app images only.
union="$("${PLAN[@]}" --since "$(git -C "${ROOT}" rev-list --max-parents=0 HEAD 2>/dev/null | tail -1)" --since unknown-sha 2>/dev/null)"
assert_contains "${union}" "frontend"
assert_contains "${union}" "backend"

book="$("${PLAN[@]}" apps/backend/internal/realdebrid/bookfiles.go .github/workflows/deploy-production.yml)"
assert_contains "${book}" "BUILD=backend"
assert_contains "${book}" "CADDY=1"
assert_not_contains "${book}" "musicbrainz-db"

search="$("${PLAN[@]}" apps/backend/internal/musicbrainz/local/search.go)"
assert_contains "${search}" "BUILD=backend"
assert_not_contains "${search}" "musicbrainz-db"

docs="$("${PLAN[@]}" deploy/musicbrainz/README.md)"
assert_not_contains "${docs}" "musicbrainz-db"

pg="$("${PLAN[@]}" deploy/musicbrainz/Dockerfile.postgres)"
assert_contains "${pg}" "BUILD=musicbrainz-db"

compose="$("${PLAN[@]}" docker-compose.yml)"
assert_contains "${compose}" "BUILD="
assert_contains "${compose}" "SYNC_COMPOSE=1"

warp="$("${PLAN[@]}" deploy/warp/entrypoint.sh)"
assert_contains "${warp}" "BUILD=abb-warp"
assert_contains "${warp}" "SYNC_COMPOSE=1"

web="$("${PLAN[@]}" apps/web/src/pages/ListenPage.tsx)"
assert_contains "${web}" "BUILD=frontend"

echo "deploy-compose plan tests passed"
