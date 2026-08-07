#!/usr/bin/env bash
# Import the official MusicBrainz database onto disk1 via mbslave.
# All data stays under ${JEDFLIX_DATA_ROOT:-/mnt/disk1/jedflix}/musicbrainz/.
set -euo pipefail

DATA_ROOT="${JEDFLIX_DATA_ROOT:-/mnt/disk1/jedflix}"
MB_ROOT="${DATA_ROOT}/musicbrainz"
DUMP_DIR="${MB_ROOT}/dumps"
PGDATA="${MB_ROOT}/pgdata"
COMPOSE_FILE="${COMPOSE_FILE:-$(cd "$(dirname "$0")/.." && pwd)/docker-compose.yml}"

mkdir -p "${DUMP_DIR}" "${PGDATA}" "${MB_ROOT}/replication" "${MB_ROOT}/meili"
mkdir -p "${DATA_ROOT}/music-artwork"/{by-mbid,by-hash,missing}

echo "== Ensuring MusicBrainz Postgres is up =="
docker compose -f "${COMPOSE_FILE}" up -d musicbrainz-db

echo "== Waiting for Postgres =="
for i in $(seq 1 60); do
  if docker compose -f "${COMPOSE_FILE}" exec -T musicbrainz-db pg_isready -U musicbrainz -d musicbrainz >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker compose -f "${COMPOSE_FILE}" exec -T musicbrainz-db pg_isready -U musicbrainz -d musicbrainz

echo "== Running mbslave init (full dump import — this takes a long time) =="
# mbslave downloads the latest fullexport and loads it into Postgres.
# Replication token is required for later sync; init itself uses public dumps.
docker compose -f "${COMPOSE_FILE}" run --rm \
  -e MBSLAVE_DB_HOST=musicbrainz-db \
  -e MBSLAVE_DB_PORT=5432 \
  -e MBSLAVE_DB_NAME=musicbrainz \
  -e MBSLAVE_DB_USER=musicbrainz \
  -e MBSLAVE_DB_PASSWORD="${MUSICBRAINZ_DB_PASSWORD:-musicbrainz}" \
  -e MBSLAVE_DB_ADMIN_USER=musicbrainz \
  -e MBSLAVE_DB_ADMIN_PASSWORD="${MUSICBRAINZ_DB_PASSWORD:-musicbrainz}" \
  -e MBSLAVE_MUSICBRAINZ_TOKEN="${MBSLAVE_MUSICBRAINZ_TOKEN:-}" \
  mbslave \
  mbslave init

echo "== Full MusicBrainz import complete =="
echo "Next: run scripts/musicbrainz-reindex.sh then scripts/musicbrainz-sync.sh (cron)."
