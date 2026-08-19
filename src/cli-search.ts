import {
  getSeenKeys,
  getStarredKeys,
  itemSeenKey,
  type ContentItemRow,
} from "./db";
import { resolveSearchPanelScope } from "./server/api-search";
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
  pace search starred:yes

Options:
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

/** Stderr summary line, mirroring the export/import command style. */
export function formatSearchSummary(query: string, count: number): string {
  if (count === 0) return `search: no matches for "${query}"`;
  return `search: ${count} ${count === 1 ? "match" : "matches"} for "${query}"`;
}
