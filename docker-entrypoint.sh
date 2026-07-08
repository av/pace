#!/bin/sh
# Runs pace as the unprivileged `bun` user (uid 1000) instead of root.
#
# The container starts as root so it can fix ownership of /app/data first:
# bind mounts and volumes created by older (root-running) images are owned
# by root, and the bun user could not open pace.db otherwise. After the
# chown, privileges are dropped permanently via setpriv.
#
# The recursive chown is guarded by a top-level ownership check: once the
# directory itself is bun-owned (fresh volumes, or any start after the first
# migration) the walk is skipped entirely, so huge bind-mounted directories
# don't pay a full recursive chown on every boot. Delete-and-recreate of the
# directory by the host resets ownership and re-triggers the migration.
#
# If the container is started with an explicit non-root --user, we are not
# root here; skip the chown and just exec (the caller owns permissions).
set -e

if [ "$(id -u)" = "0" ]; then
  if [ "$(stat -c '%u' /app/data)" != "1000" ]; then
    chown -R bun:bun /app/data
  fi
  exec setpriv --reuid bun --regid bun --clear-groups "$@"
fi

exec "$@"
