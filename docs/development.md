# Development

## Tech stack

Bun + Hono + SQLite + JSX server rendering. The only client-side JavaScript is the optional keyboard-navigation script; no-JS browsers and static snapshots get the same dashboard.

## Working on the repo

Setup, verification, the fact-driven workflow, skills layout and screenshot scripts are in [AGENTS.md](../AGENTS.md). In short: `scripts/agent-setup.sh` installs dependencies, `scripts/agent-verify.sh` runs the typecheck, tests and a serve smoke test, and before `npm link` the CLI runs as `bun run src/cli.ts ...`. Background on cloud coding agents is in [agents.md](agents.md); release notes are in [releases/](releases/) and [CHANGELOG.md](../CHANGELOG.md).
