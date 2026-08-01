# Changelog

Notable changes per release, newest first. Also published as [GitHub releases](https://github.com/av/pace/releases).

## Unreleased

### Documentation

- AGENTS.md CLI reference now lists `pace doctor` and `pace import <feeds.opml>`, which were missing.
- The stale duplicate copies of the pace-setup/pace-config skills under `.agents/skills/` (old skill names, dead cross-references, missing doctor/import/share docs) are now symlinks to the bundled `skills/` versions, so they can no longer drift.

### CI

- Bun is now pinned to 1.3.9 in both workflows, matching the Dockerfile base image and local dev, instead of floating on latest.
- Docker image publishes (tags and main) are now gated on a green typecheck + full test suite, closing the gap where tag pushes built images without any tests running.
- The Docker workflow now has a 30-minute timeout and PR-cancelling concurrency, mirroring the CI workflow.

### Testing

- Example dashboard configs (`examples/*.yaml`) are now pinned by the config-validity suite: each must validate, use only recognized adapter types and param keys, resolve every panel source, and render to balanced HTML (+33 tests).

## v0.7.1

### Bug fixes

#### UI
- Text widgets (About/How-to-Use panels) now use the same 0.85rem type scale as feed panels instead of the oversized browser default, which clipped copy in tighter layouts.
- Stronger screen-reader semantics for the dashboard: the layout is wrapped in a `<main>` landmark with a visually hidden `<h1>`, each refresh button is named after its panel ("Refresh <title>") instead of a bare "Refresh", item and panel-refreshed timestamps render as `<time>` elements with machine-readable datetimes, and feed items are marked up as a real list so assistive tech announces counts and supports list navigation.

### Dependencies

- Security update pass: `bun audit` is now clean (was 12 advisories, 6 high). Direct deps bumped within-major — hono 4.12.33 (fixes three moderate advisories incl. IPv6 deny-rule bypass), js-yaml 4.3.1 (merge-key DoS backport), fast-xml-parser 5.10.1, marked 18.0.7, sanitize-html 2.17.6, pi-ai 0.73.1. Vulnerable transitives (undici, ws, postcss, protobufjs) pinned to patched versions via `overrides` — every override stays inside its parent's declared semver range. Skipped as majors: js-yaml 5, typescript 7.

### Tooling / tests

- `scripts/verify-release.sh` — end-to-end release verification for any version: pulls the published Docker image and probes every served endpoint (health, dashboard, static assets, JSON/RSS APIs, `pace --version`/`skill`/`doctor`), checks the GitHub release notes, and runs the full test suite in a fresh tag clone. Coverage pinned by deployment-sync tests.
- `scripts/screenshot-states.py` — captures interaction-only visual states (`:focus-visible` rings, the `?` help overlay, iframe loading stripe) by pressing real keys in headless Chromium; fails nonzero if the keyboard-navigation states never appear.
- Preset screenshots refreshed, including a new 390x844 mobile capture (`assets/preset-daily-brief-mobile.png`) now taken by `scripts/screenshot-presets.sh`.
- README Docker section now has an "Upgrading" note (pull the new image tag and recreate the container), including a warning that compose-file healthcheck overrides survive image upgrades and should be re-checked against the new version.

## v0.7.0

### New features

- **JSON panel data API** — read-only `GET /api/panels` (panel list with item counts and last-refresh times) and `GET /api/panels/:panel` (items by panel id or display name, optional `?limit=1..500`). Machine-readable access to everything the dashboard renders, served under `server.base_path`, with JSON 404/400 errors and no internal fields leaked.
- **RSS output feeds** — `GET /api/panels/:panel.rss` serves any panel as a well-formed RSS 2.0 feed (stable guids, RFC 822 dates, LLM summaries as descriptions), so pace pipelines (dedupe/rank/summarize) can feed regular feed readers.
- **`pace doctor`** — live fetch-check of every configured source with per-source timing, item counts, and error details; exit code 1 when any source fails. Respects `--config`/`--preset`, never writes to the database.
- **`pace import <feeds.opml>`** — migrate from any feed reader: converts OPML exports (including nested folders, duplicates, and entity-encoded titles) into a validated pace config with one panel per folder. Output always passes `pace config check`.
- **Dashboard keyboard navigation** — `j`/`k` move between items, `h`/`l` between panels, `r` refreshes the focused panel, `?` shows a help overlay. Shipped as a small dependency-free ES module; static share exports and no-JS browsers are unaffected (progressive enhancement).

### Bug fixes

#### Ranking and LLM transforms
- Thousands-separated engagement counts ("12,345 stars") now parse fully — previously only the trailing digit group counted, inverting GitHub-trending ranking for popular repos.
- Pipeline `llm-summarize` and `llm-rank` now reuse cached summaries/scores from the previous cycle instead of re-summarizing and re-scoring (and re-fetching content for) every item on every refresh — a ~96x/day cost reduction on unchanged items.
- Hardened against hostile or runaway LLM responses: code-fence extraction no longer mangles summaries containing backticks, item fields are newline-collapsed so a crafted item cannot forge sibling entries in batch prompts, merged-item ids can no longer collide or mis-attribute rows, lens scores are clamped to 0–10, and summaries/titles are length-capped.
- LLM retry backoff and content-fetch DNS lookups now abort promptly with their signal.

#### Scheduler and data integrity
- Adapter transforms on panels shared by multiple sources no longer wipe co-tenant rows (items are now owner-scoped per source).
- Graceful shutdown drains the full refresh chain including pipeline phases, and the database is sealed after final close instead of silently re-opening.
- Config edits that remove a source from a pinned-id panel now prune that source's ghost rows at startup; rows stored under unknown panel ids are counted and reported.
- An Invalid Date on a single item no longer rolls back the whole panel save (degrades to now() with a warning).
- The HTTP port is bound before the scheduler starts, so a port conflict aborts cleanly without running an initial refresh.

#### Adapters and feed parsing
- Malformed API date strings no longer break lobsters, devto, npm, github-releases, lemmy, or mastodon; Lemmy's naive-UTC timestamps parse as UTC regardless of host timezone.
- Responses that are not RSS/Atom feeds (error pages, JSON, empty bodies) now surface as diagnosable fetch failures instead of silently reporting 0 items.
- Wikipedia multi-mode no longer collapses distinct unlinked news/on-this-day items into one; reddit subreddit names and youtube channel/playlist ids are URL-encoded; GitHub trending parses "1 star today"; release tags are percent-decoded.
- Counter panels validate `label`/`unit` params like sibling adapters.

#### Server, CLI, and config
- `pace config check` now applies the same `${VAR}` env expansion as serve, so check and serve always agree (including cyclic-placeholder and empty-document cases).
- Non-browser clients (curl, scripts) get informative text bodies for successful, skipped, and failed panel refreshes instead of empty 303s.
- `pace skill` can no longer read files outside the skills directory; image `max_height` is validated as a CSS length; RSS output strips XML-illegal control characters that would break strict feed parsers.
- `bun run src/cli.ts` now works from any cwd (per-file JSX pragmas); `/api/panels` serves strict ISO timestamps; clearer user-facing error and warning messages throughout.

#### UI
- Long unbroken titles/URLs wrap instead of forcing horizontal scrollbars; merged-item source pills wrap; `prefers-reduced-motion` disables the loading animation and hover transitions.

### Presets, Docker, and docs

- All 7 bundled presets live-verified: over-filtered "discussion" panels unstarved, oversized archive feeds bounded, devto reaction threshold tuned.
- Docker: `docker run ghcr.io/av/pace pace <cmd>` works (redundant `pace` prefix stripped); build context slimmed by ~5.4MB.
- README and agent skills synced to actual CLI behavior and locked to the code by new drift tests; keyboard navigation, `PACE_DB_PATH`, multi-source panels, and panel `id` pinning documented.

### Performance

- Dashboard panel snapshots are cached until the database changes: ~22.6ms of per-request SQLite work drops to ~0.04ms steady-state (565x) on a realistic 20k-row database.

### Tooling / tests

- Test suite grew from 2,896 to 3,205 passing tests, including seeded property/fuzz tests for parsing surfaces, long-run scheduler soak tests, and deployment/docs sync guards.

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
