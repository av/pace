FROM oven/bun:1.3.9

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY tsconfig.json config.example.yaml ./
COPY presets/ /app/presets/
COPY skills/ ./skills/

COPY docker-entrypoint.sh docker-healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-healthcheck.sh \
  && mkdir -p /app/data \
  && chown bun:bun /app/data

EXPOSE 7453

# Liveness probe against /health (200 even when a source is degraded - cached
# data is still served; non-200/unreachable means the server itself is dead).
# The script drops to the unprivileged bun user (the container's default user
# is root; the entrypoint only drops privileges for PID 1).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["docker-healthcheck.sh"]

# Starts as root only to chown /app/data (legacy root-owned volumes from
# older images), then drops to the unprivileged `bun` user via setpriv.
ENTRYPOINT ["docker-entrypoint.sh", "bun", "run", "src/cli.ts"]
CMD ["serve"]
