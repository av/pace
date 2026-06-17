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
# Edit config.yaml -- see skills/pace-dashboard-configure/SKILL.md for how to build one from scratch

# Start the dev server
bun run dev
```

The server starts at http://localhost:7453 by default.

### CLI flags and commands

For the authoritative, version-accurate help text run:

```bash
pace --help
```

**Commands overview:**

| Command | Purpose |
|---|---|
| `serve` | Run the dashboard server (default when no command given) |
| `presets list` | List bundled preset configs |
| `adapters list` | List all adapter types |
| `adapters explain <type>` | Show full documentation for an adapter |
| `transforms list` | List all transform types |
| `transforms explain <type>` | Show full documentation for a transform |
| `config check [path]` | Validate a config file without starting the server |
| `skill [name]` | List or print bundled agent skills |

Key options: `-c/--config <path>` (default `./config.yaml`), `-p/--port <number>` (default 7453), `-P/--preset <name>` (use a bundled preset), `-C/--chdir <dir>` (change working directory for config and data loads).

Environment variables `PACE_CONFIG` (config file path) and `PORT` (server port) provide overrides; CLI flags take precedence over environment variables.

### Global install

```bash
cd pace
bun install && npm link
# Now `pace` is available globally
pace --config ~/my-config.yaml
```

The CLI always resolves paths relative to the project root (where package.json lives), so `data/`, `node_modules/`, and default config paths work regardless of shell cwd.

## Docker (production)

### Using Docker Compose

```bash
# Copy and edit config
cp config.example.yaml config.yaml

# Uncomment the config volume mount in docker-compose.yml (under x-data-volume):
#   # - ./config.yaml:/app/config.yaml:ro   # uncomment to use a custom config

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

The Docker image also contains the bundled agent skills. To inspect them without running the server:

```bash
docker run --rm ghcr.io/av/pace pace skill
```

## Themed example configs

List the available presets directly:

```bash
pace presets list
# example
# tech-news
# ml-ai
# daily-brief
# product-launches
# release-tracker
# academic-papers
# video-podcast
# ops-dashboard
```

Launch with a preset:

```bash
# Bun:
pace --preset tech-news

# Docker:
docker run -d -p 7453:7453 -v pace-data:/app/data ghcr.io/av/pace:latest --preset tech-news
```

Copy a preset to `config.yaml` and customise it, then restart with your edited file (see
skills/pace-dashboard-configure/SKILL.md for detailed editing guidance).

## Beyond feeds: widgets, bookmarks, and counters

Layouts can include more than just content-feed panels. Three widget types let you
embed static content directly into the layout tree without an adapter:

- **Image widget** - logos, banners, status badges (`image:` key)
- **Text widget** - notes, changelogs, instructions in plain, markdown, or html (`text:` key)
- **Iframe widget** - embedded external pages like Grafana dashboards (`iframe:` key)

Two special adapters complement these:

- **Bookmarks** - curated link lists defined in config (no network fetch)
- **Counter** - fetches a JSON endpoint and extracts a numeric value; pair with `display: counter` on the panel for stat-card rendering

See skills/pace-dashboard-configure/SKILL.md for full config reference and examples.

## Verifying it works

1. Open http://localhost:7453 -- the dashboard should render with panel headers.
2. Content appears after the first adapter refresh cycle (within `refresh_interval` minutes, default 15).
3. To trigger an immediate refresh for a panel, POST to `/refresh/<panel-id>`.

```bash
curl -X POST http://localhost:7453/refresh/hackernews
```

4. For automated health checks (Docker, Kubernetes, load balancers), GET `/health`:

```bash
curl http://localhost:7453/health
```

Expected response: `{"status":"ok"}`

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| `config: file not found` | No config.yaml and no PACE_CONFIG set | `cp config.example.yaml config.yaml` |
| `config: ...` prefixed error | Invalid YAML or schema error in config | Run `pace config check config.yaml` for fast diagnosis without starting the server |
| `scheduler: adapter type "X" is configured but no matching adapter module was discovered` | Typo in adapter type name | Run `pace adapters list` to see all valid types |
| Panels show but no content | Adapters haven't refreshed yet | Wait for refresh_interval or POST to `/refresh/<panel-id>` |
| Port already in use | Another process on port 7453 | Use `--port 7454` or `PORT=7454` |
| LLM transforms do nothing / items unchanged | `llm` block missing or misconfigured | LLM transforms silently pass items through without a valid `llm` config -- add or fix the `llm` block and restart |
