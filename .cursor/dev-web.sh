#!/usr/bin/env bash
# Starts the Vite dev server for the JedFlix web app.
# Waits for the local Convex deployment to be serving first: dev-convex.sh writes
# the VITE_* variables into .env.local before it starts serving, so waiting for
# Convex guarantees .env.local is stable before Vite reads it. This avoids a
# first-boot race where a mid-startup .env.local change makes Vite restart/hang.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)"
export PATH="$HOME/.bun/bin:/usr/local/go/bin:/usr/local/bin:$PATH"

# Vite reads VITE_CONVEX_URL from .env.local. dev-convex.sh writes that line
# (and finishes all other .env.local edits) before it starts serving, so wait
# for the line to exist before launching Vite. This prevents Vite from starting
# mid-write and then restarting/hanging on the .env.local change.
echo "Waiting for VITE_CONVEX_URL in .env.local before starting Vite..."
for _ in $(seq 1 90); do
  if [ -f .env.local ] && grep -q '^VITE_CONVEX_URL=' .env.local; then
    echo "Convex env is ready; starting Vite."
    break
  fi
  sleep 2
done

exec bunx turbo run dev --filter=@jedflix/web -- --host 0.0.0.0
