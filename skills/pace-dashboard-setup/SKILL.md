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

### CLI flags and environment variable overrides

See `pace --help` (the canonical source of truth, defined in the HELP string and parseArgs in src/cli.ts) for the full current list of options/flags (includes -c/--config, -p/--port, -P/--preset, --list-presets, -C/--chdir, -h/--help, -v/--version; `serve` is the default command).

Environment variables `PACE_CONFIG` (config file path) and `PORT` (server port) provide overrides; CLI flags take precedence over environment variables.

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

The `docker run -d` invocation (including `-p` and volume mounts) is identical to the one under "Using Docker directly" above; simply replace the final image argument `pace` with `ghcr.io/av/pace:latest` (no `docker build` step is required).

The `/app/data` volume persists the SQLite database across container restarts.

## Verifying it works

1. Open http://localhost:7453 — the dashboard should render with panel headers.
2. Content appears after the first adapter refresh cycle (within `refresh_interval` minutes, default 15).
3. To trigger an immediate refresh for a panel, POST to `/refresh/<panel-id>`.

```bash
curl -X POST http://localhost:7453/refresh/hackernews
```

## Themed example configs

See the "Presets" section in README.md for the list of pre-built `config.*.yaml` files and their focuses (themed starter configs for common use cases).

Copy any of these as your starting `config.yaml` (see the `cp` + `bun run dev` steps in the Bun (development) section above).

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `config: file not found` | No config.yaml and no PACE_CONFIG set | `cp config.example.yaml config.yaml` |
| `config: ...` prefixed error | Invalid YAML or schema error in config | Check the error message — it points to the specific field |
| `scheduler: adapter type "X" is configured but no matching adapter module was discovered` | Typo in adapter type name | Check available types in `src/adapters/` |
| Panels show but no content | Adapters haven't refreshed yet | Wait for refresh_interval or POST to `/refresh/<panel-id>` |
| Port already in use | Another process on port 7453 | Use `--port 7454` or `PORT=7454` |
