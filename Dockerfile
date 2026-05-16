FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY src/ src/
COPY config.example.yaml ./

RUN mkdir -p /app/data && \
    useradd --system --no-create-home pace && \
    chown pace:pace /app/data

USER pace

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
