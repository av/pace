# Phase 1 — `pace <command> <args>` subcommand framework

## Context

Today `src/cli-help.ts` parses one positional via `parseArgs` and only accepts
`serve` (the default) — `resolveCliServeErrors` rejects any other command.
Info output is flag-based (`--help`, `--version`, `--list-presets`) through the
`CLI_INFO_COMMANDS` table. This phase turns the single-command CLI into a small
subcommand dispatcher so later phases can add `adapters`, `transforms`,
`config`, and `skill` commands without touching the serve path again.

## Deliverables

1. Command dispatch in `cli-help.ts` (or a new `src/cli-commands.ts`):
   - `pace` (no positional) → `serve` (unchanged behavior).
   - `pace serve [flags]` → existing serve path.
   - `pace presets list` → prints preset names, one per line (same output as
     today's `--list-presets`).
   - Unknown command → existing `Unknown command: X` + help, exit 1.
   - Unknown *subcommand* of a known command → `Unknown subcommand: X` + that
     command's usage block, exit 1.
2. Dispatcher shape: a registry
   `{ name, summary, run(positionals, values, ctx) }[]`, replacing the
   hardcoded `cmd !== "serve"` check. Info commands exit via the existing
   `cliExitOk`/`cliFailWithHelp` helpers.
3. Back-compat: `--list-presets`, `--help`, `--version` flags keep working
   (`--list-presets` becomes an alias for `presets list`; keep it in
   `CLI_KNOWN_OPTIONS`).
4. HELP string restructured into sections:

   ```
   Usage: pace [command] [options]

   Commands:
     serve            Run the dashboard server (default)
     presets list     List bundled preset configs

   Options: ...
   ```

   Later phases append to the Commands section.

## Implementation notes

- `parseArgs` is called with `allowPositionals: true` already (verify; if not,
  enable it). Positionals beyond the command name are passed to the command's
  `run`.
- Per-command flag validation: `serve` keeps the current
  `isCliKnownOption` check; info commands reject serve-only flags like
  `--port` with their usage block.
- Keep `process.chdir(projectRoot)` bootstrap in `src/cli.ts` unchanged.
- No behavioral change for `bun run dev` / Docker entrypoint (both invoke
  default serve).

## Tests

- Extend `src/cli.test.ts` / `cli-help.ts` unit tests:
  - `pace presets list` output equals `--list-presets` output.
  - `pace bogus` → exit 1, stderr `Unknown command: bogus`.
  - `pace presets bogus` → exit 1, usage for `presets`.
  - default invocation still resolves to serve.
- HELP snapshot test updated (Commands section present).

## Acceptance criteria

- All existing CLI tests pass unmodified except HELP-string assertions.
- `pace presets list`, `pace --list-presets`, `pace -h`, `pace -v`,
  `pace serve -p 7454` all behave as specified above.

## Out of scope

Adapter/transform docs commands (phase 2), agent entrypoint (phase 3).
