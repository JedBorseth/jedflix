#!/usr/bin/env bash
# Full one-shot setup: import MusicBrainz, restart backend, install cron.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${JEDFLIX_MB_SETUP_LOG:-${ROOT}/mb-setup.log}"
SYNC_LOG="${JEDFLIX_MB_SYNC_LOG:-${ROOT}/mbslave-sync.log}"

cd "${ROOT}"
set -a
source .env
set +a
export COMPOSE_FILE="${ROOT}/docker-compose.yml"

exec >> "${LOG}" 2>&1
echo "=== JedFlix MusicBrainz setup started $(date -Is) ==="

"${ROOT}/scripts/musicbrainz-import.sh"
docker compose -f "${COMPOSE_FILE}" up -d --force-recreate --no-deps backend
(
  crontab -l 2>/dev/null | grep -v musicbrainz-sync || true
  echo "0 0,12 * * * cd ${ROOT} && set -a && . ./.env && set +a && COMPOSE_FILE=${ROOT}/docker-compose.yml ./scripts/musicbrainz-sync.sh >>${SYNC_LOG} 2>&1"
) | crontab -

echo "=== JedFlix MusicBrainz setup finished $(date -Is) ==="
