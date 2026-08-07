#!/usr/bin/env bash
# Apply MusicBrainz replication packets to the local Postgres replica.
# Recommended schedule: every 12 hours (see deploy/musicbrainz/README.md).
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-$(cd "$(dirname "$0")/../.." && pwd)/docker-compose.yml}"

if [[ -z "${MBSLAVE_MUSICBRAINZ_TOKEN:-}" ]]; then
  echo "MBSLAVE_MUSICBRAINZ_TOKEN is required (MetaBrainz live data feed token)." >&2
  exit 1
fi

docker compose -f "${COMPOSE_FILE}" run --rm \
  -e MBSLAVE_DB_HOST=musicbrainz-db \
  -e MBSLAVE_DB_PORT=5432 \
  -e MBSLAVE_DB_NAME=musicbrainz \
  -e MBSLAVE_DB_USER=musicbrainz \
  -e MBSLAVE_DB_PASSWORD="${MUSICBRAINZ_DB_PASSWORD:-musicbrainz}" \
  -e MBSLAVE_MUSICBRAINZ_TOKEN="${MBSLAVE_MUSICBRAINZ_TOKEN}" \
  mbslave \
  mbslave sync

echo "MusicBrainz replication sync finished."
