# Installing and running pace

Every way to get pace running: agent skills, Docker, a preset, from source, or with your own config. The fastest path to a working `/brief.md` is in the [README](../README.md#quickstart).

## Agent skills

If you use a coding agent, install the bundled skills so it can follow the local setup commands and config schema. The skills cover installing Pace, running a preset, creating `config.yaml`, adding feeds, tuning transforms, and publishing a static snapshot.

```bash
npx skills add av/pace --skill pace-setup
npx skills add av/pace --skill pace-config
npx skills add av/pace --skill pace-brief
```

List all available skills: `npx skills add av/pace --list`.

Agents working inside the repo can read the same skills through the CLI:

```bash
git clone https://github.com/av/pace.git && cd pace
bun install && npm link

pace skill
pace skill pace-setup
pace skill pace-config
pace skill pace-brief
```

The Docker image also ships skills: `docker run --rm ghcr.io/av/pace pace skill`.

## Docker

```bash
docker run -d -p 7453:7453 -v pace-data:/app/data ghcr.io/av/pace:latest
```

Open http://localhost:7453. Health check: `curl http://localhost:7453/health` returns `{"status":"ok"}`.

The container runs pace as the unprivileged `bun` user (uid 1000). The entrypoint starts as root only long enough to ensure `/app/data` is owned by uid 1000 (a recursive `chown` that runs only when ownership is wrong, so it happens at most once per data directory), then permanently drops privileges. To manage permissions yourself, start the container with `--user 1000:1000` — the entrypoint then skips the chown, and the data directory must already be writable by that uid.

**Upgrading:** `docker pull ghcr.io/av/pace:latest` and recreate the container (`docker compose up -d --build` for local builds). Your data survives in the `pace-data` volume. The image ships its own healthcheck; `curl` is not installed, so drop any compose/run-level `curl`-based healthcheck override — it would report a permanently unhealthy container.

## With a preset

Use `--preset` (or `-P`) with Docker or source commands, for example `--preset tech-news`. See [presets.md](presets.md) for the full list.

## From source

```bash
git clone https://github.com/av/pace.git && cd pace
bun install && npm link
pace serve --preset tech-news
```

Before `npm link`, use `bun run src/cli.ts ...` instead of `pace ...`.

## Your own config

```bash
curl -O https://raw.githubusercontent.com/av/pace/main/config.example.yaml
mv config.example.yaml config.yaml
# edit config.yaml
pace config check config.yaml
pace serve --config config.yaml
```

## Custom Docker config

```bash
curl -O https://raw.githubusercontent.com/av/pace/main/config.example.yaml
mv config.example.yaml config.yaml
# edit config.yaml
docker run -d \
  -p 7453:7453 \
  -v pace-data:/app/data \
  -v ./config.yaml:/app/config.yaml:ro \
  ghcr.io/av/pace:latest
```

## For agents

Agents that want to know what's new read [the brief](brief.md) (`/brief.md`, or `pace brief`) with the `pace-brief` skill. For setup, humans install skills with `npx skills add av/pace`; agents clone pace and use `pace skill`. The [`examples/`](../examples/) directory pairs screenshots with reference configs to study when writing `config.yaml`.

Next: [server settings](server.md), [configuration](configuration.md), [CLI tools](cli.md).
