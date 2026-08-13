#!/usr/bin/env bash
# Rebuild Meilisearch indexes from the local MusicBrainz Postgres replica.
# Disabled by default — Meilisearch is being replaced by Postgres/pgvector search.
# To run intentionally: MUSICBRAINZ_REINDEX=1 ./scripts/musicbrainz-reindex.sh [only]
set -euo pipefail

if [[ "${MUSICBRAINZ_REINDEX:-0}" != "1" ]]; then
  echo "Meilisearch reindex is disabled. Set MUSICBRAINZ_REINDEX=1 to run manually." >&2
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-$(cd "$(dirname "$0")/.." && pwd)/docker-compose.yml}"
COMPOSE=(docker compose -f "${COMPOSE_FILE}" --profile music-tools)
ONLY="${1:-}"

"${COMPOSE[@]}" up -d musicbrainz-db meilisearch

args=()
if [[ -n "${ONLY}" ]]; then
  args+=(--only "${ONLY}")
fi

"${COMPOSE[@]}" run --rm \
  -e MUSICBRAINZ_DATABASE_URL="postgres://musicbrainz:${MUSICBRAINZ_DB_PASSWORD:-musicbrainz}@musicbrainz-db:5432/musicbrainz?sslmode=disable" \
  -e MEILI_URL="http://meilisearch:7700" \
  -e MEILI_API_KEY="${MEILI_MASTER_KEY:-jedflix_meili_master_change_me}" \
  music-indexer \
  "${args[@]}"

echo "Meilisearch reindex finished."
