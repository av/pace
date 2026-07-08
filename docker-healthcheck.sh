#!/bin/sh
# Container liveness probe against /health. Runs as the unprivileged bun
# user: the container's default user is root (the entrypoint drops privileges
# for PID 1 only), so a bare HEALTHCHECK CMD would probe as root for no
# reason. When the container was started with an explicit non-root --user,
# setpriv cannot switch uids; probe as that user directly.
set -e

PROBE='fetch(`http://127.0.0.1:${process.env.PORT || 7453}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))'

if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid bun --regid bun --clear-groups bun -e "$PROBE"
fi

exec bun -e "$PROBE"
