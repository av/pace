# Phase 2 — self-documenting adapters, transforms, and config check

Depends on: phase 1 (subcommand dispatcher).

## Context

`src/adapters/params.ts` (`ADAPTER_PARAM_KEYS`) is the canonical list of 17
adapter types and their allowed params; `src/transform-schema.ts`
(`TRANSFORM_FIELD_KEYS`) is the same for transforms. Neither carries
descriptions, defaults, or constraints, and none of it is reachable from the
CLI. The bundled skills drifted as a result (npm, lemmy, wikipedia missing).
This phase makes the CLI print authoritative config shapes.

## New commands

```
pace adapters list                 # one line per type: "<type> — <summary>"
pace adapters explain <type>       # description, YAML snippet, param table
pace transforms list
pace transforms explain <type>
pace config check [path]           # load + validate config, exit 0/1
```

`explain` output format (stable, plain text, agent-friendly):

```
adapter: reddit
summary: Posts from one or more subreddits.

example:
  - type: reddit
    params:
      subreddits: [programming, selfhosted]
      sort: hot
      limit: 25

params:
  subreddits  string[]  required  Subreddit names without r/
  sort        enum      hot       hot | new | top
  limit       int       25        1..100
  min_score   int       0         Drop items below this score
  time        enum      day       hour|day|week|month|year|all (sort: top)

common to all adapters: name, refresh_interval (minutes, default 15, min 1), transforms
```

## Docs metadata

1. New `src/adapters/adapter-docs.ts`:
   - `ADAPTER_DOCS: Record<AdapterType, AdapterDoc>` where `AdapterDoc` =
     `{ summary, example (YAML string), params: Record<param, { type, required?, default?, constraints?, description }> }`.
   - Defaults/constraints must be read from each adapter module's actual
     behavior (e.g. `clampAdapterLimit` calls, alias resolvers like
     wikipedia's mode aliases) — not copied from the existing SKILL.md, which
     is incomplete. Document aliases where they exist (e.g. wikipedia
     `mode`/`modes`, `mostread→most_read`).
2. New `src/transform-docs.ts`, same shape keyed by `TransformType`. Note in
   each llm-* entry that it degrades to pass-through without `llm` config.
3. `config check`:
   - Reuses the existing load path (`readConfigSource` + `config-validate.ts`
     + `transform-validate.ts`).
   - `pace config check` uses the same resolution order as serve
     (--config / PACE_CONFIG / default); `pace config check <path>` overrides.
   - Success: prints a one-line summary (`config OK: N adapters, M pipelines,
     K panels`), exit 0. Failure: prints the existing `config:`-prefixed
     error, exit 1. Must not start the server or touch the DB.

## Parity enforcement (the point of this phase)

- `adapter-docs.test.ts`: keys of `ADAPTER_DOCS` exactly equal
  `ADAPTER_TYPES`; for every type, documented param names exactly equal
  `ADAPTER_PARAM_KEYS[type]` (no missing, no extra); every param has a
  non-empty description; every example snippet parses as YAML and passes
  config validation for that adapter.
- Same for `transform-docs.test.ts` against `TRANSFORM_FIELD_KEYS`, with each
  example passing transform validation.
- Net effect: adding an adapter/transform without docs fails CI.

## CLI wiring

- Register `adapters`, `transforms`, `config` in the phase-1 dispatcher;
  add to HELP Commands section.
- `explain` with unknown type → exit 1,
  `unknown adapter type "X"\nAvailable: <list>` (mirrors the preset error
  style in `applyCliConfigEnv`).

## Tests

- CLI-level: list output contains all types; explain output for a sample
  adapter contains the param table rows; unknown type error; `config check`
  on `config.example.yaml` exits 0, on a broken fixture exits 1.

## Acceptance criteria

- Every config shape that phase 4 will show in a skill has a CLI command that
  prints it.
- `bun test` enforces docs/params parity.
