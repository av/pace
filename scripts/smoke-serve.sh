#!/bin/sh
# Offline smoke check for `pace serve`: runs the server from a temp directory
# with a bookmarks-only config (no network fetches), then checks /health and
# that /api/panels lists the panel with its items. The repo's config.yaml and
# data/ are never read or written. Exits non-zero on failure and prints the
# server log.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
pid=""

cleanup() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

cat >"$tmp/config.yaml" <<'EOF'
adapters:
  - type: bookmarks
    name: links
    params:
      items:
        - title: pace
          url: https://github.com/av/pace
        - title: Bun
          url: https://bun.sh

layout:
  direction: row
  children:
    - panel: links
      source: links
EOF

port=${PACE_SMOKE_PORT:-$(bun -e 'const s = Bun.serve({ port: 0, fetch: () => new Response() }); console.log(s.port); s.stop(true);')}

# Drop pace's env overrides so an agent's or user's environment cannot point
# the smoke run at a real config or database.
env -u PACE_CONFIG -u PACE_DB_PATH -u PORT \
  bun "$root/src/cli.ts" serve -C "$tmp" -c "$tmp/config.yaml" -p "$port" >"$tmp/serve.log" 2>&1 &
pid=$!

if ! PORT="$port" SERVER_PID="$pid" bun -e '
const base = `http://127.0.0.1:${process.env.PORT}`;
const deadline = Date.now() + 30_000;
let last = "no response";
const serverAlive = () => {
  try { process.kill(Number(process.env.SERVER_PID), 0); return true; } catch { return false; }
};
while (Date.now() < deadline) {
  if (!serverAlive()) {
    console.error("smoke-serve: FAIL: pace serve exited early");
    process.exit(1);
  }
  try {
    const health = await fetch(`${base}/health`);
    const body = await health.json();
    const panels = await (await fetch(`${base}/api/panels`)).json();
    const links = panels.panels?.find((p) => p.name === "links");
    if (health.ok && body.status === "ok" && links?.item_count === 2) {
      console.log(`smoke-serve: ok (port ${process.env.PORT}, /health ${body.status}, links panel ${links.item_count} items)`);
      process.exit(0);
    }
    last = `health=${health.status} ${JSON.stringify(body)} panels=${JSON.stringify(panels)}`;
  } catch (err) {
    last = String(err);
  }
  await Bun.sleep(250);
}
console.error(`smoke-serve: FAIL after 30s: ${last}`);
process.exit(1);
'; then
  echo "--- pace serve log ---" >&2
  cat "$tmp/serve.log" >&2
  exit 1
fi
