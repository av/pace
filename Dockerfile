FROM oven/bun:1.3.9

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY src/ src/
COPY bunfig.toml tsconfig.json config.example.yaml ./
COPY config.*.yaml /app/presets/

RUN mkdir -p /app/data

EXPOSE 7453

ENTRYPOINT ["bun", "run", "src/cli.ts"]
CMD ["serve"]
