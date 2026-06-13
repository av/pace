# Self-documenting CLI + agent-first skills — phase overview

Goal: pace's CLI becomes the source of truth for adapter/transform/config shapes
(`pace <command> <args>` style), the bundled skills point to those CLI commands
wherever they show a config shape, and the CLI help carries an
"If you're an agent, start here" section.

Phases (each has a standalone spec in this directory):

1. `01-cli-subcommands.md` — subcommand dispatch framework; migrate existing
   info flags; `pace presets list`.
2. `02-adapter-transform-docs.md` — docs metadata for all 17 adapters and 12
   transforms; `pace adapters list|explain`, `pace transforms list|explain`,
   `pace config check`; parity tests so new adapters/transforms cannot ship
   undocumented.
3. `03-agent-entrypoint.md` — `pace skill [name]` agent entrypoint; "If you're
   an agent, start here" section in `pace --help`; ship skills in the Docker
   image.
4. `04-skills-readme-sync.md` — rewrite both SKILL.md files to reference CLI
   commands next to every config shape, add missing adapters (npm, lemmy,
   wikipedia) and missing params, edit-existing-config flow, presets-first
   guidance, concrete LLM examples, troubleshooting additions; README updates;
   drift-guard test.

Dependency order is 1 → 2 → 3 → 4. Phases 2 and 3 could swap, but 4 requires
all CLI commands it references to exist.
