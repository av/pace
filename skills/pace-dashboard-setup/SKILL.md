---
name: pace-dashboard-setup
description: >
  Install and run the pace personal dashboard. Covers cloning, dependency install via Bun,
  Docker and Docker Compose deployment, CLI flags (--config, --port), environment variable
  overrides (PACE_CONFIG, PORT), themed starter configs, and troubleshooting common startup
  errors. Use when asked to set up, install, deploy, or run a pace dashboard.
compatibility: Requires Bun v1.3+ (development) or Docker (production).
---

# Set up and run pace

Install and launch a pace dashboard. Two paths: Bun for development, Docker for production.

## Prerequisites

- **Bun path:** [Bun](https://bun.sh) v1.3+ installed
- **Docker path:** Docker and Docker Compose installed

## Bun (development)

```bash
# Clone and install
git clone https://github.com/av/pace.git
cd pace
bun install

# Create config from the example
cp config.example.yaml config.yaml
# Edit config.yaml — see skills/pace-dashboard-configure/SKILL.md for how to build one from scratch

# Start the dev server
bun run dev
```

The server starts at http://localhost:7453 by default.

### CLI flags

```
pace [serve] [options]

  -c, --config <path>   Config file path (default: ./config.yaml)
  -p, --port <number>   Server port (default: 7453, or $PORT)
  -P, --preset <name>   Use a bundled preset (tech-news, ml-ai, etc.)
      --list-presets    List available bundled presets
  -h, --help            Show help
  -v, --version         Show version
```

`serve` is the default command — running bare `pace` starts the server.

### Environment variable overrides

| Variable | Purpose | Default |
|---|---|---|
| `PACE_CONFIG` | Path to config file | `./config.yaml` |
| `PORT` | Server port | `7453` |

CLI flags take precedence over environment variables.

### Global install

```bash
cd pace
bun link
# Now `pace` is available globally
pace --config ~/my-config.yaml
```

The CLI always resolves paths relative to the project root (where package.json lives), so `data/`, `node_modules/`, and default config paths work regardless of shell cwd.

## Docker (production)

### Using Docker Compose

```bash
# Copy and edit config
cp config.example.yaml config.yaml

# Uncomment the config volume mount in docker-compose.yml:
#   - ./config.yaml:/app/config.yaml:ro

docker compose up -d
```

### Using Docker directly

```bash
docker build -t pace .
docker run -d \
  -p 7453:7453 \
  -v ./config.yaml:/app/config.yaml:ro \
  -v pace-data:/app/data \
  pace
```

### Using the prebuilt image

```bash
docker run -d \
  -p 7453:7453 \
  -v ./config.yaml:/app/config.yaml:ro \
  -v pace-data:/app/data \
  ghcr.io/av/pace:latest
```

The `/app/data` volume persists the SQLite database across container restarts.

## Verifying it works

1. Open http://localhost:7453 — the dashboard should render with panel headers.
2. Content appears after the first adapter refresh cycle (within `refresh_interval` minutes, default 15).
3. To trigger an immediate refresh for a panel, POST to `/refresh/<panel-id>`.

```bash
curl -X POST http://localhost:7453/refresh/hackernews
```

## Themed example configs

The repo includes pre-built configs for common use cases:

| File | Focus |
|---|---|
| `config.example.yaml` | Minimal starter (HN + RSS) |
| `config.tech-news.yaml` | Tech news aggregation |
| `config.ml-ai.yaml` | AI/ML research |
| `config.product-launches.yaml` | Product launches and demos |
| `config.release-tracker.yaml` | Software release tracking |
| `config.academic-papers.yaml` | Academic paper feeds |
| `config.video-podcast.yaml` | Video and podcast content |

Copy any of these as your starting `config.yaml`:

```bash
cp config.ml-ai.yaml config.yaml
bun run dev
```

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `config: file not found` | No config.yaml and no PACE_CONFIG set | `cp config.example.yaml config.yaml` |
| `config: ...` prefixed error | Invalid YAML or schema error in config | Check the error message — it points to the specific field |
| `scheduler: adapter type "X" is configured but no matching adapter module was discovered` | Typo in adapter type name | Check available types in `src/adapters/` |
| Panels show but no content | Adapters haven't refreshed yet | Wait for refresh_interval or POST to `/refresh/<panel-id>` |
| Port already in use | Another process on port 7453 | Use `--port 7454` or `PORT=7454` |
