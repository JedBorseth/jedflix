#!/usr/bin/env bash
# Starts the Vite dev server for the JedFlix web app.
# Waits for the local Convex deployment to be serving first: dev-convex.sh writes
# the VITE_* variables into .env.local before it starts serving, so waiting for
# Convex guarantees .env.local is stable before Vite reads it. This avoids a
# first-boot race where a mid-startup .env.local change makes Vite restart/hang.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)"
export PATH="$HOME/.bun/bin:/usr/local/go/bin:/usr/local/bin:$PATH"

# Vite watches .env.local. dev-convex.sh finishes every .env.local write (its own
# managed lines plus VITE_*) before it creates this readiness sentinel and starts
# serving, so waiting for the sentinel means Vite starts against a stable
# .env.local — no mid-write reload or hang. Falls back to the VITE_CONVEX_URL line
# after the timeout so the server still comes up if Convex is slow/unavailable.
READY_FILE="/tmp/jedflix-convex-ready"
echo "Waiting for Convex readiness before starting Vite..."
for _ in $(seq 1 90); do
  if [ -f "$READY_FILE" ]; then
    echo "Convex is ready; starting Vite."
    break
  fi
  sleep 2
done
if [ ! -f "$READY_FILE" ] && [ -f .env.local ] && grep -q '^VITE_CONVEX_URL=' .env.local; then
  echo "Readiness sentinel not seen; VITE_CONVEX_URL present, starting Vite anyway."
fi

exec bunx turbo run dev --filter=@jedflix/web -- --host 0.0.0.0
