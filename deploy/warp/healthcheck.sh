#!/bin/bash
set -euo pipefail

curl -fsS --connect-timeout 5 --max-time 8 \
	--socks5-hostname "127.0.0.1:${WARP_SOCKS_PORT:-40001}" \
	"https://www.cloudflare.com/cdn-cgi/trace" \
	| grep -qE "warp=(on|plus)"
