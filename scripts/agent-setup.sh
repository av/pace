#!/bin/sh
# Zero-interaction setup for a fresh clone: cloud agent sandboxes, CI, new
# machines. Installs the pinned Bun if none is on PATH, then the locked
# dependencies. Needs no secrets and creates no config.yaml or data/ (pace
# falls back to config.example.yaml; scripts/smoke-serve.sh uses a temp dir).
# Safe to re-run. Next step: scripts/agent-verify.sh
set -eu

cd "$(dirname "$0")/.."

# Keep in sync with the Dockerfile base image and .github/workflows/ci.yml.
BUN_VERSION=1.3.9

if ! command -v bun >/dev/null 2>&1 && [ -x "$HOME/.bun/bin/bun" ]; then
  PATH="$HOME/.bun/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "agent-setup: bun not found, installing bun $BUN_VERSION"
  if command -v curl >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1; then
    curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION" >/dev/null
    PATH="$HOME/.bun/bin:$PATH"
  elif command -v npm >/dev/null 2>&1; then
    npm install -g "bun@$BUN_VERSION" >/dev/null
  else
    echo "agent-setup: cannot install bun (need curl+unzip or npm); see https://bun.sh" >&2
    exit 1
  fi
  echo "agent-setup: add bun to PATH in later shells: export PATH=\"\$HOME/.bun/bin:\$PATH\""
fi

have=$(bun --version)
if [ "$have" != "$BUN_VERSION" ]; then
  echo "agent-setup: note: bun $have found, CI and Docker use $BUN_VERSION"
fi

bun install --frozen-lockfile

echo "agent-setup: done (bun $have). Verify with: scripts/agent-verify.sh"
