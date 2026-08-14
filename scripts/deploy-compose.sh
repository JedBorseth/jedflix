#!/usr/bin/env bash
# Build and recreate only Compose services whose files changed.
# Leaves MusicBrainz data, music-ai GPU models, and music-embed running unless
# those services' sources changed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-compose.sh --since <git-sha>
  ./scripts/deploy-compose.sh --plan [--] <path> [<path>...]
  ./scripts/deploy-compose.sh --full

--since   Diff <sha>..HEAD and update only affected images/containers.
--plan    Print the deploy plan (no docker). Paths from args or stdin.
--full    Rebuild and recreate the default Compose stack (music infra included).
EOF
}

FULL=false
PLAN=false
SINCE=""
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)
      FULL=true
      shift
      ;;
    --plan)
      PLAN=true
      shift
      ;;
    --since)
      SINCE="${2:-}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      FILES+=("$@")
      break
      ;;
    *)
      FILES+=("$1")
      shift
      ;;
  esac
done

plan_from_files() {
  local frontend=0 backend=0 music_ai=0 music_embed=0 musicbrainz_db=0 caddy=0 sync_compose=0
  local p
  for p in "$@"; do
    p="${p#./}"
    case "$p" in
      docker-compose.yml | docker-compose.yaml)
        sync_compose=1
        ;;
      deploy/Caddyfile)
        caddy=1
        ;;
      apps/music-ai | apps/music-ai/*)
        music_ai=1
        ;;
      deploy/musicbrainz | deploy/musicbrainz/*)
        musicbrainz_db=1
        ;;
      apps/backend/cmd/music-embed | apps/backend/cmd/music-embed/* | \
      apps/backend/internal/musicbrainz | apps/backend/internal/musicbrainz/* | \
      apps/backend/internal/musicai | apps/backend/internal/musicai/*)
        backend=1
        music_embed=1
        ;;
      apps/backend/Dockerfile | apps/backend/go.mod | apps/backend/go.sum)
        backend=1
        music_embed=1
        ;;
      apps/backend | apps/backend/*)
        backend=1
        ;;
      apps/web | apps/web/* | packages | packages/* | convex | convex/* | \
      package.json | bun.lock | turbo.json | deploy/nginx.conf | \
      apps/*/package.json)
        frontend=1
        caddy=1
        ;;
    esac
  done

  if [[ "$backend" == 1 ]]; then
    caddy=1
  fi

  local build=()
  [[ "$frontend" == 1 ]] && build+=(frontend)
  [[ "$backend" == 1 ]] && build+=(backend)
  [[ "$music_ai" == 1 ]] && build+=(music-ai)
  [[ "$music_embed" == 1 ]] && build+=(music-embed)
  [[ "$musicbrainz_db" == 1 ]] && build+=(musicbrainz-db)

  if ((${#build[@]})); then
    echo "BUILD=${build[*]}"
  else
    echo "BUILD="
  fi
  echo "CADDY=${caddy}"
  echo "SYNC_COMPOSE=${sync_compose}"
}

changed_files_since() {
  local since="$1"
  if ! git cat-file -e "${since}^{commit}" 2>/dev/null; then
    echo "Unknown --since ${since}; building app images only (music infra left running)." >&2
    printf '%s\n' apps/web/Dockerfile apps/backend/Dockerfile
    return
  fi
  git diff --name-only "${since}" HEAD
}

run_plan() {
  local build_line caddy_line sync_line
  build_line="$(echo "$1" | awk -F= '/^BUILD=/ { print $2 }')"
  caddy_line="$(echo "$1" | awk -F= '/^CADDY=/ { print $2 }')"
  sync_line="$(echo "$1" | awk -F= '/^SYNC_COMPOSE=/ { print $2 }')"

  local -a build_services=()
  # shellcheck disable=SC2206
  build_services=(${build_line})

  if ((${#build_services[@]})); then
    echo "== Building: ${build_services[*]} =="
    docker compose build "${build_services[@]}"
    echo "== Recreating (no deps, so music infra stays up) =="
    docker compose up -d --no-deps "${build_services[@]}"
  else
    echo "== No image rebuilds =="
  fi

  if [[ "${sync_line}" == 1 ]]; then
    echo "== Applying Compose config without rebuilding images =="
    docker compose up -d --remove-orphans
  fi

  if [[ "${caddy_line}" == 1 ]]; then
    echo "== Reloading Caddy =="
    docker compose up -d --force-recreate --no-deps caddy
  fi
}

if [[ "${FULL}" == true ]]; then
  echo "== Full stack rebuild (includes music infra) =="
  docker compose up -d --build --remove-orphans
  docker compose up -d --force-recreate --no-deps caddy
  docker compose ps
  exit 0
fi

PLAN_TEXT=""
if ((${#FILES[@]})); then
  PLAN_TEXT="$(plan_from_files "${FILES[@]}")"
elif [[ -n "${SINCE}" ]]; then
  mapfile -t FILES < <(changed_files_since "${SINCE}")
  if ((${#FILES[@]} == 0)); then
    echo "== HEAD already matches ${SINCE}; skipping Docker =="
    exit 0
  fi
  echo "== Changed files =="
  printf '  %s\n' "${FILES[@]}"
  PLAN_TEXT="$(plan_from_files "${FILES[@]}")"
elif [[ "${PLAN}" == true ]]; then
  mapfile -t FILES
  PLAN_TEXT="$(plan_from_files "${FILES[@]}")"
else
  usage >&2
  exit 2
fi

echo "${PLAN_TEXT}"
if [[ "${PLAN}" == true ]]; then
  exit 0
fi

run_plan "${PLAN_TEXT}"
docker compose ps
echo "Selective Compose deploy finished."
