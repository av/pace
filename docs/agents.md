# Cloud coding agents and pace

How Meta's Muse Code and xAI's Grok agents find their instructions, skills, tools and environment, and what pace provides for each. Researched 2026-09-26 from the vendors' own docs and source; links are inline. Where the docs are thin, the text says so and marks what was inferred.

For the short version (setup and verify commands), see the "Cloud sandboxes" section of [AGENTS.md](../AGENTS.md). This file is background for maintainers.

## Compatibility

| | Muse Code (Meta) | Grok Build (xAI CLI) | Grok Bot (xAI, hosted) |
|---|---|---|---|
| What it is | Terminal agent on Muse Spark models. Runs where you install it: laptop, container, CI. | Terminal agent on Grok models. Same: laptop, container, CI. | Hosted assistant on a persistent cloud computer (browser, terminal, files). |
| Instruction files | `AGENTS.md`, `CLAUDE.md`, `.agents/AGENTS.md`, `.claude/CLAUDE.md`, root down to cwd, deeper wins; only after workspace trust | `AGENTS.md`, `Agents.md`, `AGENT.md`, `CLAUDE.md`, `Claude.md`, `CLAUDE.local.md`, plus `.grok/rules/*.md`, `.claude/rules/*.md`, `.cursor/rules/*.md`; every match loads; only after folder trust | Not documented. It works through its terminal and browser, so it reads what it is told to read. |
| Project skills | `.agents/skills/<id>/SKILL.md` | `.grok/skills/`, `.agents/skills/`, `.claude/skills/`, `.cursor/skills/`, cwd up to repo root; deduped by name | From its Marketplace and "Private skills". No repo skill discovery documented. |
| MCP servers | User settings only (`mcp_servers` in `~/.config/muse/settings.json`); no project file documented | `.grok/config.toml` (`[mcp_servers.*]`), `.mcp.json`, `.cursor/mcp.json`, `~/.claude.json` | Marketplace connectors; "same MCP servers, plugins, and skills as Cursor" |
| Environment setup | None of its own. Whatever image or VM you run it in; hooks in `.muse/hooks.json` can run commands at `SessionStart`. | None of its own. Whatever image or VM you run it in; `SessionStart` hooks. | Cursor-hosted computer, `/workspace` persists. Bring-your-own image not supported. |
| Secrets | `META_API_KEY` for headless auth | `XAI_API_KEY`, or device-code sign-in (`--device-auth`) for headless auth | Secure secret requests; connector tokens kept off the computer |
| Network | OS sandbox on by default; network `proxy-only` (asks per new host). Headless runs need `--sandbox-network enabled` or `--yolo` for `bun install`. | Sandbox optional; `workspace` profile allows network, `read-only`/`strict` block child-process network on Linux | Internet through shared egress IPs; admins can allowlist |
| Browser | Not documented as a built-in tool (web tools exist, `--disable-web-tools`) | `web_search`/`web_fetch`; no browser automation documented | Yes, a real browser on the cloud computer |
| Bun | Anything installed in the environment | Same | Can install packages; nothing preinstalled documented |
| What pace gives it | `AGENTS.md`, `.agents/skills/*`, `scripts/agent-setup.sh` / `agent-verify.sh` | `AGENTS.md`, `.agents/skills/*` (and `.claude/skills`), same scripts | `AGENTS.md` and the scripts, to follow when asked; `.cursor/environment.json` if it hands work to a Cursor cloud agent |
| Checked locally | Yes: `muse skills list --trust-workspace` in a clean container lists all 12 project skills | Yes: `grok inspect` in a clean container shows `AGENTS.md` and all 12 project skills | No: hosted only, needs a pushed branch and a Grok Bot account |

## Muse Code (Meta)

Muse Code is Meta's coding agent harness, announced alongside Muse Spark 1.2 ([announcement](https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2)). "Muse Spark" is the model; Muse Code is the agent. Docs: [overview](https://dev.meta.ai/docs/muse-code), [configuration and context](https://dev.meta.ai/docs/muse-code/configuration), [extending and automating](https://dev.meta.ai/docs/muse-code/extending), [permissions and safety](https://dev.meta.ai/docs/muse-code/permissions), [workflows](https://dev.meta.ai/docs/muse-code/workflows), [changelog](https://dev.meta.ai/docs/muse-code/changelog).

- **Instructions.** Reads `AGENTS.md`, `CLAUDE.md`, `.agents/AGENTS.md` and `.claude/CLAUDE.md`, from the workspace up to the `.git` boundary. Project rules beat user rules; deeper files beat shallower ones. They load only after the workspace is trusted (`--trust-workspace`, or `--yolo`). `muse init` scaffolds an `AGENTS.md`. Project memory lives in `.agents/memory/` (loads even untrusted).
- **Skills.** Project skills are `<repo>/.agents/skills/<id>/SKILL.md`. User skills also come from `~/.agents/skills`, `~/.claude/skills`, `$CODEX_HOME/skills`. Managed with `muse skills list|inspect|enable|validate|import`.
- **MCP.** `mcp_servers` block in the user settings file, with `${VAR}` interpolation (1.2.1). No project-level MCP file is documented.
- **Hooks and workflows.** Project hooks in `.muse/hooks.json` (run outside the sandbox). Project workflows in `.agents/workflows/*.js`. Both load only in trusted workspaces.
- **Sandbox.** On by default: bubblewrap on Linux, Seatbelt on macOS. Writes go to the workspace and temp only; `.git`, `.muse` and `.agents` stay read-only to the agent. Network defaults to `proxy-only`, which stops on each new host for approval. That stalls an unattended `bun install`; use `--sandbox-network enabled`, or run `scripts/agent-setup.sh` before starting the agent.
- **Headless.** `muse exec "<prompt>"` (or `--prompt-file`), exit code 0 or 1, `--json` for JSONL events, `--max-model-steps` to cap work. Auth by `META_API_KEY`.
- **Cloud.** Docs are thin here. The "async background agents" in the announcement are subagents inside a local session, not a hosted service. No Meta-hosted repo agent, environment file or GitHub app is documented. Inferred: "Muse in the cloud" means running `muse exec` in your own container or CI job, so the repo needs to set itself up from a plain shell. That's what `scripts/agent-setup.sh` is for.

## Grok Build (xAI CLI)

Grok Build is xAI's terminal agent ([overview](https://docs.x.ai/build/overview), [source](https://github.com/xai-org/grok-build)). The full user guide ships in the repo under [`crates/codegen/xai-grok-pager/docs/user-guide/`](https://github.com/xai-org/grok-build/tree/main/crates/codegen/xai-grok-pager/docs/user-guide); the facts below come from there and from [project rules](https://docs.x.ai/build/features/project-rules) and [skills, plugins, marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces).

- **Instructions** (`12-project-rules.md`). At every directory from the repo root down to cwd it loads `AGENTS.md`, `Agents.md`, `AGENT.md`, `CLAUDE.md`, `Claude.md`, `CLAUDE.local.md` and `.claude/CLAUDE*.md`, plus every `*.md` in `.grok/rules/`, `.claude/rules/` and `.cursor/rules/`. **Every matching file loads**, so a folder with both `AGENTS.md` and `CLAUDE.md` gets both. That is why pace has no `CLAUDE.md` symlink: Grok would read the same text twice. Gitignored files are skipped. Needs folder trust (`grok --trust`, or `~/.grok/trusted_folders.toml`).
- **Skills** (`08-skills.md`). `.grok/skills/`, `.claude/skills/`, `.cursor/skills/` and `.agents/skills/`, walked from cwd to the repo root, deduplicated by name. Skill discovery ignores `.gitignore`. Needs folder trust.
- **MCP** (`07-mcp-servers.md`). `.grok/config.toml` `[mcp_servers.<name>]`, `.mcp.json` at the project root, `.cursor/mcp.json`, `~/.claude.json`. Use `${VAR}` for secrets in committed files.
- **Headless** (`14-headless-mode.md`). `grok -p "<prompt>"`, `--output-format json`, `--max-turns`, `--yolo`. Auth by `XAI_API_KEY` or device-code sign-in (`--device-auth`) (`02-authentication.md`).
- **Sandbox** (`18-sandbox.md`). Opt-in profiles (Landlock/seccomp on Linux). `workspace` allows network; `read-only` and `strict` block child-process network, which breaks `bun install`.
- **Environment.** No environment or setup file of its own. `SessionStart` hooks in `.grok/hooks/` can run setup (`10-hooks.md`). There is `grok cursor-worker` ("register this machine as a Cursor private worker") but no doc page for it.
- **Check it yourself.** `grok inspect` lists the instruction files, skills and MCP servers Grok found for the current directory.

## Grok Bot (xAI, hosted)

Grok Bot is xAI's hosted assistant ([overview](https://docs.x.ai/grok-bot/overview), [computer and apps](https://docs.x.ai/grok-bot/computer-and-apps), [security](https://docs.x.ai/grok-bot/security), [skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations), [Grok Bot 101](https://x.ai/bot/guides/grok-bot-101)).

- Each Bot has "a persistent cloud computer with a browser, filesystem, and terminal". Files persist in `/workspace`. It runs "only on Cursor-hosted cloud computers"; on-prem and bring-your-own-image are not supported. Sign-in is with a Cursor account.
- Network goes out through shared static egress IPs; admins can restrict to an allowlist.
- Skills come from the Marketplace and a "Private skills" list, and "Grok Bot supports the same MCP servers, plugins, and skills as Cursor". No repo file discovery (`AGENTS.md`, skill directories) is documented.
- **Docs are thin** on everything a repo cares about: OS image, preinstalled runtimes, how it clones, which files it reads. Inferred: it's a general computer-use agent. It clones with `git` in its terminal, and reads `AGENTS.md` if the task or its own habits say so. The guide shows it handing coding work to a Cursor cloud agent ("hands a clean prompt to a Cursor cloud agent for the inner loop").
- **Cursor cloud agents**, the likely inner loop, [read `AGENTS.md`](https://cursor.com/docs/cloud-agent/setup) and run the `install` command from `.cursor/environment.json` on every build (it must be idempotent). pace's file runs `scripts/agent-setup.sh`. Cursor's docs recommend a cloud-only setup and testing section in `AGENTS.md`, which is the "Cloud sandboxes" section.

## What makes a repo work well for these agents

From the docs above, and from running pace in clean containers:

1. **One instruction file.** Both CLIs read `AGENTS.md`, and Grok loads every recognised file, so copies or `CLAUDE.md` symlinks double the context. Keep `AGENTS.md` as the only one. Grok's own guidance: actionable instructions, not a copy of the README.
2. **Skills in `.agents/skills/`.** It's the only project skill directory both Muse and Grok scan. pace keeps the real files in `skills/` (bundled with `pace skill`) and symlinks them in; both agents follow the symlinks.
3. **Setup from a plain shell, with no questions.** None of these agents has a setup-file format of its own (Cursor's `environment.json` is the exception), so a single idempotent script is the portable choice. It shouldn't need secrets, and it shouldn't need `config.yaml`.
4. **Network only at install.** Muse's default sandbox asks before each new host and Grok's strict profiles block child-process network. Tests must pass offline and as root (many sandboxes run as root, where `chmod 000` doesn't block reads).
5. **Don't trust the environment's defaults.** In the live run below, the shell that Grok Build gave its commands exported `FORCE_COLOR=1` and `CLICOLOR_FORCE=1` next to `NO_COLOR=1`. Bun then colours `console.log` numbers and child-process stderr, which broke a byte-exact CLI test and the smoke script's port. The test preload (`src/test/preload.ts`) now clears those variables, and the scripts avoid coloured output.
6. **One verify command with a clear exit code**, plus machine-readable output (`--json`, `/health`, `/api/*`) for checking results without scraping HTML.
7. **Workspace trust.** Both CLIs skip project instructions and skills until the folder is trusted. Headless runs need `--trust-workspace`/`--yolo` (Muse) or a `trusted_folders.toml` entry (Grok).

## What pace has

- `AGENTS.md`: CLI reference, skills, facts workflow, and a "Cloud sandboxes" section with setup, verify and machine-readable output.
- `scripts/agent-setup.sh`: installs the pinned bun if missing (official installer, or npm as a fallback), then `bun install --frozen-lockfile`. Idempotent. No secrets, no `config.yaml`.
- `scripts/agent-verify.sh`: typecheck, `bun test --max-concurrency=8`, and the serve smoke. Works offline after setup.
- `scripts/smoke-serve.sh`: serves a bookmarks-only config (no fetches) from a temp dir on a free port, checks `/health` and `/api/panels`. Also runs in CI.
- `.agents/skills/` (and `.claude/skills` → `.agents/skills`): `pace-setup`, `pace-config`, the facts skills and the rest.
- `.cursor/environment.json`: `install` runs `scripts/agent-setup.sh` on Cursor cloud agents.

Not added, on purpose: `CLAUDE.md` or `.agents/AGENTS.md` (duplicate context), `.grok/` and `.muse/` directories (nothing to configure: pace has no MCP server, and setup belongs in the script), and a devcontainer or new Dockerfile (none of these agents reads one; the existing `Dockerfile` is the production image).

## Live runs

Neither hosted product could be pointed at the branch from this machine: Grok Bot needs a pushed branch and a Grok Bot account, and no Meta-hosted Muse agent exists to point anything at. Instead, the real CLIs ran headless in a clean `oven/bun:1.3.9` container, on a fresh clone with only their auth files, using this prompt: set the repo up from its own instructions, verify it, and report what you read and ran.

- **Grok Build 1.0.40, first run** (2026-09-26, `grok -p … --yolo --max-turns 60`). It read `AGENTS.md`, found the `pace-setup` and `pace-config` skills, and ran `scripts/agent-setup.sh` (passed) and `scripts/agent-verify.sh`. That failed because its shell forces colour (see item 5 above). It worked out the cause, re-ran with the colour variables unset, and got 3652 pass, 1 skip, 0 fail, plus smoke ok. It also reported the `pace-setup` skill's wrong `config: file not found` row, and that the `pace-setup` skill and the sandbox instructions overlap. Both were fixed afterwards. It didn't create `config.yaml` or commit.
- **Grok Build 1.0.40, second run**, on the fixed branch with nothing unset. It read `AGENTS.md` and this file. `scripts/agent-setup.sh` and `scripts/agent-verify.sh` both exited 0: 3652 pass, 1 skip (the root-only case), 0 fail, smoke ok. No `config.yaml`, clean tree. It still pointed out that "use `/pace-setup` when asked to install or run pace" in the Skills section could match a setup request. That line now sends repo setup to the scripts.
- **Muse Code 1.4.0**. Didn't run: 1.4.0 rejected the existing `~/.config/muse/auth.json` (`unsupported auth schema version 2`), on the host too. It needs a fresh `muse login`, which is interactive. Skill discovery (`muse skills list --trust-workspace`) needs no auth, and it did run in the container.
