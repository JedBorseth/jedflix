#!/usr/bin/env bash
# Bring JedFlix Compose back if Docker/apt bounced it and Caddy failed to bind.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
exec /usr/bin/docker compose up -d --no-deps caddy
