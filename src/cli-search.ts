import {
  getSeenKeys,
  getStarredKeys,
  itemSeenKey,
  type ContentItemRow,
} from "./db";
import { resolveSearchPanelScope, serializeApiSearchItem } from "./server/api-search";
import { parseApiPanelItemsLimit } from "./server/api-panels";
import { buildLayoutRuntimeMaps } from "./layout/domain";
import { getAdapterName } from "./utils";
import type { AppConfig } from "./config/types";

export function formatSearchUsage(): string {
  return `Usage:
  pace search <query...>       Search stored dashboard items from the terminal

Speaks the same grammar as /api/search and the dashboard's "/" filter bar:
whitespace-separated terms match ALL of title/url/source/summary/body
case-insensitively, plus the operators starred:yes|no, seen:yes|no, and
panel:<id> (panel: needs the active config to resolve the id). Newest 50
matches; each hit is marked ★ when starred and · when already read.

Examples:
  pace search rust async
  pace search seen:no panel:hacker-news
  pace search --json --limit 5 starred:yes

Options:
  --json                Emit hits as JSON (the /api/search shape plus
                        starred/seen booleans) instead of text lines
  -n, --limit <n>       Maximum hits to return (1-500, default 50)
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -P, --preset <name>   Use a bundled preset config
  -C, --chdir <dir>     Change to directory (for config/data loads)
`;
}

/**
 * Resolve a `panel:` operator against the config's layout, exactly like the
 * /api/search endpoint resolves `?panel=` (panel id or display name; the
 * "all recent items" pseudo-panel widens back to every panel). Throws a
 * `search:`-prefixed error for unknown panels.
 */
export function resolveSearchCliPanelId(
  config: AppConfig,
  panel: string,
): string | undefined {
  const maps = buildLayoutRuntimeMaps(
    config.layout,
    config.adapters.map(getAdapterName),
    config.pipelines,
  );
  const scope = resolveSearchPanelScope(undefined, panel, maps);
  if (!scope.ok) throw new Error(`search: ${scope.error}`);
  return scope.panelId;
}

/** Star/read state marks for one search hit, read once per invocation. */
export interface SearchStateMarks {
  starredKeys: ReadonlySet<string>;
  seenKeys: ReadonlySet<string>;
}

export function loadSearchStateMarks(): SearchStateMarks {
  return {
    starredKeys: new Set(getStarredKeys()),
    seenKeys: new Set(getSeenKeys()),
  };
}

/**
 * One search hit as two stdout lines: a mark column (★ starred, · seen,
 * space otherwise — starred wins, matching how starred items stay prominent
 * on the dashboard), the story timestamp, the panel, and the title; then the
 * URL indented beneath.
 */
export function formatSearchHit(row: ContentItemRow, marks: SearchStateMarks): string[] {
  const key = itemSeenKey(row);
  const mark = marks.starredKeys.has(key) ? "★" : marks.seenKeys.has(key) ? "·" : " ";
  // Titles can carry newlines (e.g. Mastodon posts) — keep each hit on one line.
  const title = row.title.replace(/\s+/g, " ").trim();
  const lines = [`${mark} ${row.timestamp}  [${row.panel_id}] ${title}`];
  if (row.url !== "") lines.push(`    ${row.url}`);
  return lines;
}

export function formatSearchResults(
  rows: readonly ContentItemRow[],
  marks: SearchStateMarks,
): string {
  return rows.flatMap((row) => formatSearchHit(row, marks)).join("\n");
}

/**
 * Parse a `--limit` value with the exact semantics of the API's `?limit=`
 * (integer 1-500), so the CLI and /api/search agree on what a limit means.
 * Absent → undefined (caller applies the default). Throws a `search:`-prefixed
 * error on invalid values.
 */
export function parseSearchCliLimit(raw: string | undefined): number | undefined {
  const result = parseApiPanelItemsLimit(raw);
  if (!result.ok) throw new Error(`search: ${result.error}`);
  return result.limit;
}

/**
 * The whole result set as pretty-printed JSON for `--json`: the /api/search
 * response shape (query/count/items with each item's `panel`), with each item
 * additionally carrying `starred`/`seen` booleans — the CLI reads the state
 * marks anyway, so scripts get them structurally instead of parsing ★/· glyphs.
 */
export function formatSearchJson(
  query: string,
  rows: readonly ContentItemRow[],
  marks: SearchStateMarks,
): string {
  const items = rows.map((row) => {
    const key = itemSeenKey(row);
    return {
      ...serializeApiSearchItem(row),
      starred: marks.starredKeys.has(key),
      seen: marks.seenKeys.has(key),
    };
  });
  return JSON.stringify({ query, count: rows.length, items }, null, 2);
}

/** Stderr summary line, mirroring the export/import command style. */
export function formatSearchSummary(query: string, count: number): string {
  if (count === 0) return `search: no matches for "${query}"`;
  return `search: ${count} ${count === 1 ? "match" : "matches"} for "${query}"`;
}
