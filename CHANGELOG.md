# Changelog

Notable changes per release, newest first. Also published as [GitHub releases](https://github.com/av/pace/releases).

## v0.6.6

### BREAKING: one-way database schema migration

The items table primary key changed from `id` to a composite `(id, panel_id)`, so a source feeding multiple panels no longer "steals" items between them — each panel now keeps its own copy. Existing databases are migrated automatically and transactionally on first startup (including pre-rename legacy schemas).

**The migration is one-way.** Older pace versions fail against a migrated database with SQLite error `ON CONFLICT clause does not match`. To downgrade, delete `data/pace.db` (or restore a backup). 

### New features

- **`server.retention_days`** — configurable item retention (default 30 days; `0` disables pruning). Pruning runs at startup and every 24h; invalid values are rejected at config validation.
- **`llm.timeout_seconds`** — configurable LLM completion timeout (default 120s). A hung provider (e.g. a stalled local Ollama) can no longer block a panel's refresh slot forever.
- **Richer `/health` endpoint** — was a hardcoded `{status:"ok"}`; now reports overall `ok|degraded` plus per-source `status` (`ok|failing|pending`), `lastError` (cleared on recovery), `lastSuccessAt`/`lastFailureAt`, `lastDurationMs`, and `lastItemCount`. Documented in README.
- **Refresh feedback in the UI** — skipped refreshes redirect to a status banner (`?skipped=`), and browser-initiated refresh failures redirect to an error banner (`?failed=`) instead of a dead text/plain 502 page (non-browser clients still get 502).
- **Graceful shutdown** — SIGTERM/SIGINT now stops the scheduler, stops the HTTP listener, drains in-flight refreshes (10s timeout), then closes the database; also cleans up properly when the port is already in use (friendly `EADDRINUSE` message instead of a raw stack trace).
- **Bookmarks improvements** — stable url-hash item ids (summaries/scores survive reorders), first-seen timestamps (new links surface on top, existing ones age naturally), and stale rows are pruned when entries are removed from config. Duplicate bookmark entries that collapse to one row now produce a config warning.
- **Config warnings** — new warnings for panels mixing a pipeline with its upstream adapter, and an accurate shared-source warning.
- CLI: `--preset` combined with `--config` is now rejected; unknown flags, missing option values, and stray positionals are rejected on all subcommands instead of being silently ignored.

### Bug fixes

#### Scheduler / data integrity
- Serialized per-panel writes to prevent lost updates when concurrent refreshes touch a shared panel.
- Pipelines no longer re-transform their own output on shared panels (which duplicated LLM calls and grew ids unboundedly); adapter-level transforms no longer wipe pipeline output; enriched pipeline copies now win read-side dedup over raw items.
- Deduplicated pipeline input across shared read-key panels and same-id copies (count-limited transforms no longer fill slots with duplicates).
- Canonicalized `fetched_at` format (mixed ISO/SQLite formats broke "last refreshed", dedup tie-breaks, and same-day pruning).
- Future-dated feed items are clamped at ingestion (5-min tolerance) so clock-skewed feeds no longer pin to the top of panels forever.
- `refresh_interval` is clamped to the 32-bit timer maximum (huge values previously wrapped into a ~1ms tight refresh loop).

#### Adapters and feed parsing
- Feed XML: numeric text nodes are no longer coerced (`<title>1984</title>` rendered "(untitled)"); date elements with attributes parse correctly; non-page atom link rels (enclosure/self/…) are no longer used as item URLs.
- HTML entity decoding rewritten single-pass: astral code points (emoji) decode correctly, invalid refs pass through, escaped entities no longer double-decode; ~45 typographic/currency entities added.
- Malformed JSON elements no longer crash whole fetches: reddit, stackexchange, lemmy, mastodon, npm, devto, lobsters, github-releases now validate/degrade per element.
- Mastodon account mode: ids, dedup keys, and @handles now use each account's home instance, not the configured instance.
- Product Hunt maker extraction prefers embedded JSON over page-wide anchor scanning.
- Counter panels: non-numeric remote JSON values render a placeholder instead of `[object Object]`/`NaN`; `abbreviateNumber` gains B/T tiers and correct rounding-boundary promotion (999.95M → "1B", not "1000M").
- Cluster transform: idempotent `[label]` annotation (no more stacking prefixes), distinct fallback labels, and public-suffix-aware domain similarity (bbc.co.uk vs guardian.co.uk no longer cluster).

#### LLM transforms
- Malformed LLM response shapes (wrong types, missing fields) now pass items through unchanged instead of failing the whole refresh; hallucinated/repeated ids in merge groups are dropped instead of fabricating ghost items.

#### Server / sharing
- `server.base_path`: trailing-slash root no longer 404s; refresh flows redirect straight to the canonical base path; routes also served under the prefix for non-stripping reverse proxies.
- `pace share export`/`gist` no longer reject dashboards whose feed content contains `${...}` text; gist publishing gains a 30s timeout, token trimming, and status-specific error hints (401/403/404/422).

### Security / hardening

- Prototype-pollution-safe lookups everywhere untrusted keys reach plain objects (config option aliases, HTML entity names, env substitution, source color classes, counter env interpolation) — e.g. feed content `&constructor;` no longer rendered function source.
- Cross-site request guard on `POST /refresh/:panel` (Sec-Fetch-Site / Origin checks; curl and same-origin unaffected).
- Render-time src guards for iframe/image widgets (blocks `javascript:`/`data:` and no longer 500s on unparseable URLs); `rel="noopener"` forced on any targeted link in rendered text.
- LLM and gist network calls are now timeout-bounded.

### Docker

- **Container now runs as non-root**: starts as root only to `chown` `/app/data` (guarded, skipped when already owned), then drops to the `bun` user (uid 1000) via `setpriv`. Explicit `--user` starts bypass the chown. Legacy root-owned volumes keep working; see README for the bind-mount caveat.
- Reproducible builds via `bun install --frozen-lockfile` (lockfile now required).
- `HEALTHCHECK` added, probing `/health` as the non-root user.

### Tooling / CI

- GitHub Actions CI runs `bun run typecheck` and `bun test` on push/PR.
- `tsc --noEmit` now passes; `typecheck` and `test` package scripts added.
- Test suite grew from 2,560 to 2,854 passing tests.
