#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=17453
URL="http://localhost:$PORT"
PRESETS=(academic-papers daily-brief ml-ai product-launches release-tracker tech-news video-podcast)

for preset in "${PRESETS[@]}"; do
  echo "=== $preset ==="
  TMPDB="$(mktemp -d)"
  PACE_DB="$TMPDB/pace.db" bun run src/cli.ts serve -p "$PORT" -P "$preset" &
  SERVER_PID=$!

  # Wait for server to be ready
  for i in $(seq 1 60); do
    if curl -sf "$URL" >/dev/null 2>&1; then break; fi
    sleep 0.5
  done

  # Wait for adapters to fetch data
  sleep 10

  playwright screenshot \
    --browser chromium \
    --viewport-size "1440,900" \
    --wait-for-timeout 2000 \
    "$URL" \
    "$ROOT/assets/preset-${preset}.png"

  echo "  saved assets/preset-${preset}.png"

  # One mobile-width capture (of the flagship preset) to catch stacked-layout
  # regressions without doubling the tracked asset set.
  if [ "$preset" = "daily-brief" ]; then
    playwright screenshot \
      --browser chromium \
      --viewport-size "390,844" \
      --wait-for-timeout 2000 \
      "$URL" \
      "$ROOT/assets/preset-${preset}-mobile.png"
    echo "  saved assets/preset-${preset}-mobile.png"
  fi

  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMPDB"
done

echo "Done."
