#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WARP_TARGET_PID="${1:?warp-svc PID is required}"
RECOVERY_FILE="${WARP_RECOVERY_FILE:-/run/abb-warp-last-recovery}"
failures=0

while kill -0 "${WARP_TARGET_PID}" 2>/dev/null; do
	sleep "${WARP_CHECK_INTERVAL_SECONDS:-60}"
	if "${SCRIPT_DIR}/abb-connectivity.sh" >/dev/null 2>&1; then
		failures=0
		continue
	fi
	failures=$((failures + 1))
	if ((failures < 3)); then
		continue
	fi
	last_recovery=0
	if [[ -f "${RECOVERY_FILE}" ]]; then
		read -r last_recovery < "${RECOVERY_FILE}" || true
	fi
	case "${last_recovery}" in
		'' | *[!0-9]*) last_recovery=0 ;;
	esac
	now="$(date +%s)"
	# /run survives a container restart, preventing a restart loop during a
	# genuine ABB outage. A recreated container starts with a clean cooldown.
	if ((now - last_recovery < 600)); then
		continue
	fi
	printf '%s\n' "${now}" > "${RECOVERY_FILE}"
	echo "ABB proxy connection failed three consecutive checks; restarting WARP (10 minute cooldown)" >&2
	kill "${WARP_TARGET_PID}"
	exit 0
done
