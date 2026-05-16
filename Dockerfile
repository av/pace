FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY src/ src/
COPY config.example.yaml ./

RUN mkdir -p /app/data

RUN adduser --disabled-password --gecos "" pace
USER pace

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
