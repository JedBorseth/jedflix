#!/usr/bin/env bash
# Rebuild Meilisearch indexes from the local MusicBrainz Postgres replica.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-$(cd "$(dirname "$0")/../.." && pwd)/docker-compose.yml}"
ONLY="${1:-}"

docker compose -f "${COMPOSE_FILE}" up -d musicbrainz-db meilisearch

args=()
if [[ -n "${ONLY}" ]]; then
  args+=(--only "${ONLY}")
fi

docker compose -f "${COMPOSE_FILE}" run --rm \
  -e MUSICBRAINZ_DATABASE_URL="postgres://musicbrainz:${MUSICBRAINZ_DB_PASSWORD:-musicbrainz}@musicbrainz-db:5432/musicbrainz?sslmode=disable" \
  -e MEILI_URL="http://meilisearch:7700" \
  -e MEILI_API_KEY="${MEILI_MASTER_KEY:-jedflix_meili_master_change_me}" \
  music-indexer \
  "${args[@]}"

echo "Meilisearch reindex finished."
