#!/bin/bash
set -euo pipefail

# Any HTTP response proves the proxy can reach ABB. In particular, 403/429/5xx
# must not cause tunnel restarts: those need an upstream recovery or cooldown.
curl -sS --head --output /dev/null --connect-timeout 5 --max-time 8 \
	--socks5-hostname "127.0.0.1:${WARP_SOCKS_PORT:-40001}" \
	"${ABB_BASE_URL:-https://audiobookbay.lu}/"
