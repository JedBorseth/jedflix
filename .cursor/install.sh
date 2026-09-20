#!/usr/bin/env bash
# Cloud Agent install step for JedFlix.
# Installs the toolchains that are not in the base image, installs project
# dependencies, and provisions the local Convex deployment. Idempotent: safe to
# re-run against a warm/cached VM.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Toolchains (only installed when missing) ---------------------------------
if [ ! -x "$HOME/.bun/bin/bun" ] && ! command -v bun >/dev/null 2>&1; then
  echo "==> Installing Bun 1.3.14"
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
fi
export PATH="$HOME/.bun/bin:$PATH"

if [ ! -x /usr/local/go/bin/go ]; then
  echo "==> Installing Go 1.25.1"
  curl -fsSL -o /tmp/go.tar.gz https://go.dev/dl/go1.25.1.linux-amd64.tar.gz
  sudo rm -rf /usr/local/go
  sudo tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz
fi
export PATH="/usr/local/go/bin:$PATH"

if [ ! -x /usr/local/bin/yt-dlp ]; then
  echo "==> Installing yt-dlp"
  sudo curl -fsSL -o /usr/local/bin/yt-dlp \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
  sudo chmod a+rx /usr/local/bin/yt-dlp
fi

# ffmpeg is used by yt-dlp for some audio formats; install only if absent.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "==> Installing ffmpeg"
  sudo apt-get update -y
  sudo apt-get install -y --no-install-recommends ffmpeg
fi

# --- Persist PATH + Convex anonymous mode for login-shell terminals ----------
if ! grep -q 'JEDFLIX_ENV' "$HOME/.bashrc" 2>/dev/null; then
  cat >> "$HOME/.bashrc" <<'RC'
# JEDFLIX_ENV
export PATH="$HOME/.bun/bin:/usr/local/go/bin:/usr/local/bin:$PATH"
export CONVEX_AGENT_MODE=anonymous
RC
fi

# --- Dependencies ------------------------------------------------------------
echo "==> Installing JS dependencies (bun install)"
bun install

echo "==> Downloading Go modules"
( cd apps/backend && /usr/local/go/bin/go mod download )

# --- Convex local deployment + auth keys + env -------------------------------
echo "==> Bootstrapping local Convex deployment"
bash .cursor/dev-convex.sh bootstrap

echo "==> Install complete"
