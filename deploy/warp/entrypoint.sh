#!/bin/bash
# Cloudflare WARP in proxy-only mode. This process has its own network
# namespace; even a mistaken tunnel mode cannot steal the host default route
# or SSH. We still refuse warp/NAT modes so ABB is the only caller.
set -euo pipefail

WARP_SOCKS_PORT="${WARP_SOCKS_PORT:-40001}"
PUBLISH_SOCKS_PORT="${PUBLISH_SOCKS_PORT:-40000}"

if [[ "${WARP_ENABLE_NAT:-}" != "" ]]; then
	echo "WARP_ENABLE_NAT is not allowed. This container must stay in proxy mode." >&2
	exit 1
fi

if [[ ! -e /dev/net/tun ]]; then
	mkdir -p /dev/net
	mknod /dev/net/tun c 10 200
	chmod 600 /dev/net/tun
fi

mkdir -p /run/dbus
if [[ -f /run/dbus/pid ]]; then
	rm -f /run/dbus/pid
fi
dbus-daemon --system --fork

warp-svc --accept-tos &
WARP_PID=$!

cleanup() {
	kill "${WARP_PID}" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 40); do
	if warp-cli --accept-tos status >/dev/null 2>&1; then
		break
	fi
	sleep 0.5
done

if ! warp-cli --accept-tos status >/dev/null 2>&1; then
	echo "warp-svc did not become ready" >&2
	exit 1
fi

if ! warp-cli --accept-tos registration show >/dev/null 2>&1; then
	out="$(warp-cli --accept-tos registration new 2>&1 || true)"
	echo "${out}"
	if ! echo "${out}" | grep -qiE "already|still around|Success|registered"; then
		if ! warp-cli --accept-tos registration show >/dev/null 2>&1; then
			echo "WARP registration failed: ${out}" >&2
			exit 1
		fi
	fi
fi

ensure_proxy_mode() {
	# Do not disconnect first: that flips always-on off and races the MASQUE tunnel.
	warp-cli --accept-tos mode proxy
	warp-cli --accept-tos proxy port "${WARP_SOCKS_PORT}" >/dev/null 2>&1 \
		|| warp-cli --accept-tos set-proxy-port "${WARP_SOCKS_PORT}"
	warp-cli --accept-tos dns families off >/dev/null 2>&1 || true
	warp-cli --accept-tos connect
}

ensure_proxy_mode

settings="$(warp-cli --accept-tos settings 2>/dev/null || true)"
if echo "${settings}" | grep -qiE 'WarpProxy|Mode:[[:space:]]*Proxy'; then
	:
elif echo "${settings}" | grep -qiE 'Mode:[[:space:]]*(Warp|Tunnel)'; then
	echo "Refusing to stay connected: WARP mode is not proxy:" >&2
	echo "${settings}" >&2
	warp-cli --accept-tos disconnect >/dev/null 2>&1 || true
	exit 1
fi

socat TCP-LISTEN:"${PUBLISH_SOCKS_PORT}",bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:"${WARP_SOCKS_PORT}" &
SOCAT_PID=$!

guard() {
	while kill -0 "${WARP_PID}" 2>/dev/null; do
		sleep 30
		current="$(warp-cli --accept-tos settings 2>/dev/null || true)"
		if echo "${current}" | grep -qiE 'WarpProxy|Mode:[[:space:]]*Proxy'; then
			:
		elif echo "${current}" | grep -qiE 'Mode:[[:space:]]*(Warp|Tunnel)'; then
			echo "WARP left proxy mode; forcing proxy" >&2
			ensure_proxy_mode || true
		fi
		status="$(warp-cli --accept-tos status 2>/dev/null || true)"
		if ! echo "${status}" | grep -qi connected; then
			echo "WARP not connected; reconnecting in proxy mode" >&2
			ensure_proxy_mode || true
		fi
	done
}
guard &

wait "${WARP_PID}"
kill "${SOCAT_PID}" 2>/dev/null || true
