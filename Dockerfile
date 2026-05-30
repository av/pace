FROM oven/bun:1.3.9

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY src/ src/
COPY bunfig.toml tsconfig.json config.example.yaml docker-entrypoint.sh ./
COPY config.*.yaml /app/presets/

RUN mkdir -p /app/data /app/presets && \
    useradd --system --no-create-home pace && \
    chown -R pace:pace /app/data /app/presets

USER pace

EXPOSE 7453

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
