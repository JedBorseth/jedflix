#!/usr/bin/env bash
# Runs (and, on first use, provisions) the local anonymous Convex deployment
# that JedFlix develops against. Idempotent: safe to run on every boot.
#
#   .cursor/dev-convex.sh            -> provision if needed, then serve (convex dev)
#   .cursor/dev-convex.sh bootstrap  -> provision only, then exit (used by install)
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)"

export PATH="$HOME/.bun/bin:/usr/local/go/bin:/usr/local/bin:$PATH"
# No Convex account is required in the Cloud Agent; use an anonymous local backend.
export CONVEX_AGENT_MODE=anonymous

# Create/refresh the local deployment, push functions, and regenerate
# convex/_generated. Reuses the existing deployment when one is present.
bunx convex dev --once

# Point Vite (and the Go backend, which also reads the root .env.local) at the
# local Convex deployment. Convex manages CONVEX_URL/CONVEX_SITE_URL; the app
# code reads the VITE_-prefixed variants.
touch .env.local
if ! grep -q '^VITE_CONVEX_URL=' .env.local; then
  {
    echo ""
    echo "# Local Convex dev deployment (added by .cursor/dev-convex.sh)"
    echo "VITE_CONVEX_URL=http://127.0.0.1:3210"
    echo "VITE_CONVEX_SITE_URL=http://127.0.0.1:3211"
    echo "VITE_BACKEND_URL=/backend"
  } >> .env.local
fi

# Convex Auth needs signing keys on the deployment to initialise. OAuth provider
# secrets (AUTH_GITHUB_ID/SECRET, AUTH_GOOGLE_ID/SECRET) are optional and can be
# added later with `bunx convex env set ...` to enable actual sign-in.
if ! bunx convex env get JWT_PRIVATE_KEY >/dev/null 2>&1; then
  node .cursor/gen-auth-keys.mjs
fi

if [ "${1:-serve}" = "bootstrap" ]; then
  echo "Convex bootstrap complete."
  exit 0
fi

exec bunx convex dev --tail-logs disable
