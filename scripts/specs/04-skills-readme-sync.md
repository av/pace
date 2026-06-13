# Phase 4 — skills reference the CLI; close content gaps; README sync

Depends on: phases 1–3 (every CLI command referenced below must exist).

## Principle

Skills stay rich — full explanations, worked examples, decision guidance —
but every config shape they show is paired with the CLI command that prints
the authoritative version, e.g.:

```yaml
# Authoritative shape: pace adapters explain reddit
- type: reddit
  params: ...
```

The CLI is the source of truth for *shapes*; the skills are the source of
truth for *judgment* (which adapter for which interest, pipeline design,
layout taste).

## Changes to `skills/pace-dashboard-configure/SKILL.md`

1. Top of file: a "Source of truth" note — run `pace adapters list`,
   `pace adapters explain <type>`, `pace transforms list|explain <type>` for
   current shapes; snippets in the skill are illustrative and may lag.
2. Add the three missing adapters with full sections: `npm`, `lemmy`,
   `wikipedia` (params from `pace adapters explain`, including wikipedia mode
   aliases). Add missing params on existing sections (`mastodon.
   min_favourites`, `devto.per_page`, `hackernews.stories`,
   `twitter.bearer_token`, `rss.limit`).
3. Every adapter and transform section gets its `# Authoritative shape:` CLI
   comment (per the principle above).
4. New section "Start from a preset" placed before the from-scratch process:
   `pace presets list`, `pace --preset <name>`, the bundled
   `config.*.yaml` themes, and guidance: prefer preset + targeted edits when
   the user's ask matches a theme; from-scratch only when nothing fits.
5. New section "Modifying an existing config": read the user's current
   config.yaml first; make minimal edits; validate with `pace config check`;
   restart-vs-refresh behavior (verify in `scheduler.ts` whether config is
   re-read without restart — document whichever is true; expected: restart
   required, then `POST /refresh/<panel-id>` to fill panels immediately).
6. LLM section: two concrete provider examples (anthropic + openai with
   current model ids), env-var wiring for both Bun (`LLM_API_KEY=... bun run
   dev`) and Docker (`-e LLM_API_KEY=...`), and a reminder that llm-*
   transforms pass items through unchanged when `llm` is absent.
7. Process list updated: step 0 = consider presets; final step = run
   `pace config check` on the written file.

## Changes to `skills/pace-dashboard-setup/SKILL.md`

1. CLI flags section: replace the prose pointer with `pace --help` plus the
   new Commands overview (serve, presets, adapters, transforms, config
   check, skill).
2. Themed configs section: show `pace presets list` / `--preset` directly
   instead of deferring to README.
3. Common issues table additions:
   - `config:` errors → run `pace config check` for fast iteration without
     starting the server.
   - unknown adapter type → `pace adapters list` to see valid types.
   - LLM transforms silently doing nothing → `llm` block missing/misconfigured.
4. Mention that the Docker image contains the skills:
   `docker run --rm ghcr.io/av/pace pace skill`.

## README

- Adapters section: add `pace adapters list` / `pace adapters explain <type>`
  alongside the SKILL.md pointer.
- Transforms and LLM sections: same treatment with `pace transforms ...`.
- New short "For agents" subsection pointing at `pace skill`.

## Drift guard

- New test `skills-sync.test.ts`: for every type in `ADAPTER_TYPES` and
  `TRANSFORM_TYPES`, `skills/pace-dashboard-configure/SKILL.md` contains a
  `### <type>` heading (or the type name in a designated coverage list).
  Keeps the skill from silently missing future adapters, without asserting
  on prose.

## Acceptance criteria

- Every YAML shape in either SKILL.md has an adjacent CLI command reference.
- `npm`, `lemmy`, `wikipedia` documented; param lists match
  `ADAPTER_PARAM_KEYS` (spot-checked by the drift-guard test at the
  type level, by review at the param level).
- An oblivious-user request like "drop youtube, show only LLM news from HN"
  is answerable from the configure skill alone (edit-existing flow +
  filter/exclude transforms + validation command).
