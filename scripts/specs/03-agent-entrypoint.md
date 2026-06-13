# Phase 3 — agent entrypoint: `pace skill` + "If you're an agent, start here"

Depends on: phase 1 (dispatcher). References commands from phase 2 in its
output, so ship after phase 2 (or stub the references).

## Context

Coding agents (Claude Code etc.) interact with pace via the bundled skills in
`skills/`. Following the `browser-agent` pattern, the CLI itself should route
agents to those skills, so an agent that only has the binary (e.g. inside the
Docker image) can bootstrap without the repo checkout.

## Deliverables

1. `pace skill` — lists available bundled skills, one per line:

   ```
   pace-dashboard-setup      Install and run a pace dashboard
   pace-dashboard-configure  Generate or modify a config.yaml from interests

   Run `pace skill <name>` to print the full skill.
   ```

   Names and descriptions are read from the SKILL.md frontmatter at build
   time or runtime (see implementation notes) — not duplicated by hand.

2. `pace skill <name>` — prints the full SKILL.md body to stdout (frontmatter
   stripped or kept verbatim — keep verbatim; agents handle frontmatter fine).
   Unknown name → exit 1 with available list.

3. HELP gets a top section, before Commands:

   ```
   If you're an agent, start here:
     pace skill                      list agent skills
     pace skill pace-dashboard-setup     set up / run a dashboard
     pace skill pace-dashboard-configure create or edit config.yaml
   ```

4. Docker image ships `skills/` (add `COPY skills ./skills` to Dockerfile if
   not already included) so `docker run ... ghcr.io/av/pace pace skill ...`
   works.

## Implementation notes

- Skill discovery: read `skills/*/SKILL.md` relative to project root (cli.ts
  already chdirs there). Parse only the frontmatter `name:` and first line of
  `description:` — a tiny hand-rolled parser is fine; do not add a YAML
  frontmatter dependency if `Bun.YAML`/existing config YAML parser can be
  reused.
- No network, no DB. Pure read-and-print.
- Exit codes: 0 on success, 1 on unknown skill.

## Tests

- `pace skill` lists exactly the directories under `skills/` that contain a
  SKILL.md, with descriptions from frontmatter.
- `pace skill pace-dashboard-setup` output contains a known heading from the
  file.
- `pace skill nope` → exit 1 + available list.
- HELP snapshot includes the agent section.
- Docker: smoke assertion (existing image test pattern if any; otherwise note
  in Dockerfile review) that `/app/skills` exists in the image.

## Acceptance criteria

- An agent with only the Docker image can run `pace --help`, see the agent
  section, and retrieve both skills' full text via `pace skill <name>`.
