#!/usr/bin/env bash
# Verify a published pace release exactly as an end user would consume it:
#   1. Pull ghcr.io/av/pace:<version> fresh and smoke-test the container
#      (serve endpoints, pace --version, pace skill, pace doctor).
#   2. Check the GitHub release exists and is not a draft.
#   3. Fresh-clone the v<version> tag, bun install, typecheck, full test suite.
#
# Usage: scripts/verify-release.sh <version> [port]
#   e.g. scripts/verify-release.sh 0.7.0
set -euo pipefail

VERSION="${1:?usage: scripts/verify-release.sh <version> [port]}"
PORT="${2:-17963}"
IMAGE="ghcr.io/av/pace:$VERSION"
TAG="v$VERSION"
NAME="pace-verify-${VERSION//./-}"
URL="http://127.0.0.1:$PORT"
WORKDIR="$(mktemp -d)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo; echo "=== $* ==="; }

step "1/3 container smoke tests ($IMAGE)"
docker rmi "$IMAGE" >/dev/null 2>&1 || true
docker pull "$IMAGE"

GOT_VERSION="$(docker run --rm "$IMAGE" pace --version)"
[ "$GOT_VERSION" = "$VERSION" ] || fail "pace --version reported '$GOT_VERSION', expected '$VERSION'"
echo "pace --version -> $GOT_VERSION"

docker run --rm "$IMAGE" pace skill | grep -q "pace-setup" || fail "pace skill output missing pace-setup"
echo "pace skill -> ok"

docker run --rm "$IMAGE" pace doctor || fail "pace doctor reported failing sources"

if curl -sf -o /dev/null "$URL" 2>/dev/null; then fail "port $PORT is already in use"; fi
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:7453" "$IMAGE" >/dev/null
for i in $(seq 1 60); do
  if curl -sf "$URL/health" >/dev/null 2>&1; then break; fi
  [ "$i" = 60 ] && fail "server did not become ready on $URL"
  sleep 0.5
done
for path in /health / /dashboard.js /styles.css /api/panels; do
  code="$(curl -s -o /dev/null -w "%{http_code}" "$URL$path")"
  [ "$code" = 200 ] || fail "GET $path returned $code"
  echo "GET $path -> 200"
done
PANEL_ID="$(curl -s "$URL/api/panels" | bun -e 'const d = await new Response(Bun.stdin.stream()).json(); console.log(d.panels[0].id);')"
code="$(curl -s -o /dev/null -w "%{http_code}" "$URL/api/panels/$PANEL_ID.rss")"
[ "$code" = 200 ] || fail "GET /api/panels/$PANEL_ID.rss returned $code"
curl -s "$URL/api/panels/$PANEL_ID.rss" | grep -q '<rss version="2.0"' || fail "RSS output missing <rss> root"
echo "GET /api/panels/$PANEL_ID.rss -> 200 (well-formed root)"
for i in $(seq 1 60); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$NAME")"
  [ "$health" = healthy ] && break
  [ "$i" = 60 ] && fail "container health is '$health', expected healthy"
  sleep 1
done
echo "container health -> healthy"

step "2/3 GitHub release ($TAG)"
gh release view "$TAG" --json isDraft,tagName,body \
  --jq 'if .isDraft then error("release is a draft") else "release \(.tagName) ok (\(.body | length) chars of notes)" end' \
  || fail "gh release view $TAG failed"

step "3/3 fresh clone of $TAG"
git clone --quiet --depth 1 --branch "$TAG" git@github.com:av/pace.git "$WORKDIR/pace"
cd "$WORKDIR/pace"
bun install --silent
CLONE_VERSION="$(./bin/pace --version)"
[ "$CLONE_VERSION" = "$VERSION" ] || fail "clone bin/pace --version reported '$CLONE_VERSION'"
bun x tsc --noEmit
echo "typecheck -> ok"
bun test 2>&1 | tail -4

echo
echo "release $TAG verified: image, GitHub release, and tagged tree are all good"
