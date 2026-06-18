## pace CLI

pace is a personal dashboard that aggregates content from RSS, Hacker News, Reddit, GitHub, arXiv, YouTube, Mastodon, and more. Use the CLI to explore adapters, transforms, presets, and validate configs:

```bash
pace --help                      # full CLI reference
pace adapters list               # all adapter types
pace adapters explain <type>     # docs for one adapter
pace transforms list             # all transform types
pace transforms explain <type>   # docs for one transform
pace presets list                # bundled starter configs
pace config check [path]         # validate config without starting the server
pace skill [name]                # list or print bundled agent skills
```

## Skills

Skills for working with pace dashboards are in `.agents/skills/` (symlinked from `.claude/skills/`):

- **pace-dashboard-setup** — install, run, and deploy pace (Bun dev, Docker, Docker Compose, CLI flags, troubleshooting)
- **pace-dashboard-configure** — generate or modify `config.yaml` from a natural-language description of interests

Use `/pace-dashboard-setup` when asked to install or run pace. Use `/pace-dashboard-configure` when asked to configure, customize, or add feeds to a dashboard.

## Example dashboards

`examples/` pairs showcase configs (`<name>.yaml`) with screenshots (`<name>.png`). README preset images live separately in `assets/preset-<name>.png`.

**Edit a config:** change `examples/<name>.yaml`, then `pace config check examples/<name>.yaml`.

**Refresh example screenshots:** Playwright required (`pip install playwright && playwright install chromium`). From repo root:

```bash
python3 examples/screenshot.py
```

For each `*.yaml` in `examples/`, the script copies it to a temp dir, starts `pace serve` on port 17453, waits for adapters to fetch, and overwrites the matching `.png` (1920×1080 full-page).

**Refresh preset screenshots** (README `assets/` images):

```bash
scripts/screenshot-presets.sh
```

Serves each bundled preset on port 17453 via `pace serve -P <preset>`, screenshots at 1440×900.

<!-- facts:start -->
## Fact-driven development

This project uses [facts](https://github.com/av/facts) for specification and documentation. All work flows through the fact sheet - it is the source of truth.

**Every change starts with a fact.** Facts are the spec - they define what "done" means. Code that isn't described by a fact is unverifiable and will be treated as incorrect. The skill `facts skills show facts` has the full format spec and command reference.

See the facts skill's "## Agent workflows" section (run `facts skills show facts`) for the canonical process: always start with `facts list` (or `ll`) / `facts check` to orient; use `facts add` (with `--tags "spec"`) before implementing; verify with `facts check --tags "<tag>"` or `facts get <id>` (never bare `facts check`); mark done with `facts edit <id> --add-tag implemented`. (The prerequisite that verification only works after `facts add` is part of that guidance.)

**Manual facts (`?` in check output):** these have no command, so you verify them by reading the relevant code. For each `?` fact: read what it claims, check the code, report PASS or FAIL with a one-line reason (see the project's established 'name: ' + errorMessage(err) prefix convention from adapters/types or cli/config rather than ad-hoc). Reporting "N manual" without verifying each one is not acceptable.

**Lifecycle:** `@draft` → `@spec` → `@implemented`

**Domain:** the `## domain` section in `.facts` defines the project's entities and relations - read it first to learn the vocabulary.

**Skills** (invoke via `facts skills show <name>`):
- `facts-refine` - sharpen `@draft` facts into `@spec` with the user
- `facts-discover` - scan the codebase and sync facts to reality (only when explicitly asked)
- `facts-implement` - implement `@spec` facts in code, verify, tag `@implemented`
<!-- facts:end -->

## After making changes

Run this to update the globally installed `pace` CLI:

```
bun install && npm link
```

The global `pace` binary is a symlink to `./src/cli.ts` (bun runs TS directly), so source changes are live immediately. This command only matters when dependencies or `package.json` bin entries change.
