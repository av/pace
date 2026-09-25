#!/bin/sh
# Verify a change the way CI does, plus a live serve smoke check. Works
# offline once scripts/agent-setup.sh has installed dependencies. Tests are
# capped at 8 concurrent so shared hosts are not saturated.
set -eu

cd "$(dirname "$0")/.."

# agent-setup.sh may have installed bun to ~/.bun/bin in an earlier shell.
if ! command -v bun >/dev/null 2>&1; then
  PATH="$HOME/.bun/bin:$PATH"
fi

echo "== typecheck"
bun run typecheck

echo "== tests"
bun test --max-concurrency=8

echo "== serve smoke"
sh scripts/smoke-serve.sh

echo "agent-verify: all checks passed"
