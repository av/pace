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
pace doctor                      # fetch-check every configured source live
pace import <feeds.opml>         # convert an OPML feed export to a pace config
pace export [output.opml]        # export configured feed URLs as OPML
pace notify test [rule]          # send a test delivery to notify webhooks
pace search <query...>           # search stored items (same grammar as /api/search; --json, --limit N, --rss prints the saved-search feed URL, --mark-seen/--mark-unseen set read marks, --star/--unstar set star marks)
pace panels list                 # list the active config's panels (ids, names, stored item counts, sources; --json for machine output)
pace skill [name]                # list or print bundled agent skills
```

## Cloud sandboxes

For a fresh clone with nothing set up (Muse Code, Grok, Cursor cloud agents, CI). No secrets, `config.yaml` or `data/` needed. Don't create them to make checks pass.

```bash
scripts/agent-setup.sh     # installs pinned bun if missing, then bun install --frozen-lockfile (the only step that needs network)
scripts/agent-verify.sh    # typecheck + bun test (max 8 concurrent) + serve smoke; works offline
scripts/smoke-serve.sh     # just the smoke: serves a bookmarks-only config from a temp dir, checks /health and /api/panels
```

**How to verify a change:** run `scripts/agent-verify.sh`. If you added facts for the change, also run `facts check --tags <tag>` (if `facts` is missing: `npm install -g @avcodes/facts`). Tests must pass with no network: stub `fetch` and DNS as `src/fetch-content.test.ts` does, and don't rely on file permissions that root ignores. For machine-readable output use `pace search --json` and `pace panels list --json`, or the server's `/health` and `/api/*` JSON. `pace config check <path>` exits non-zero with a `config:` message on bad configs.

In a sandbox, run the CLI as `bun src/cli.ts <command>`. The `pace-setup` skill and the README describe installing pace for a user (`config.yaml`, `npm link`, Docker); for working on the repo, use the scripts above. The `npm link` step under "After making changes" is for Ivan's machine only.

Per-agent details (which files each agent reads, sandbox and network limits) are in [docs/agents.md](docs/agents.md).

## Skills

Skills for working with pace dashboards live in `skills/` (the copies bundled with the CLI via `pace skill`); `.agents/skills/pace-setup` and `.agents/skills/pace-config` are symlinks to them, and `.claude/skills` is a symlink to `.agents/skills`:

- **pace-setup** — install, run, and deploy pace (Bun dev, Docker, Docker Compose, CLI flags, troubleshooting)
- **pace-config** — generate or modify `config.yaml` from a natural-language description of interests

Use `/pace-setup` when a user asks to install or run pace as a dashboard. To set up this repo for development or verify a change, follow "Cloud sandboxes" above instead. Use `/pace-config` when asked to configure, customize, or add feeds to a dashboard.

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
