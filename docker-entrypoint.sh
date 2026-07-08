#!/bin/sh
# Runs pace as the unprivileged `bun` user (uid 1000) instead of root.
#
# The container starts as root so it can fix ownership of /app/data first:
# bind mounts and volumes created by older (root-running) images are owned
# by root, and the bun user could not open pace.db otherwise. After the
# chown, privileges are dropped permanently via setpriv.
#
# If the container is started with an explicit non-root --user, we are not
# root here; skip the chown and just exec (the caller owns permissions).
set -e

if [ "$(id -u)" = "0" ]; then
  chown -R bun:bun /app/data
  exec setpriv --reuid bun --regid bun --clear-groups "$@"
fi

exec "$@"
