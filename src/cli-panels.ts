import { buildLayoutRuntimeMaps } from "./layout/domain";
import { getAdapterName } from "./utils";
import type { AppConfig } from "./config/types";

export function formatPanelsUsage(): string {
  return `Usage: pace panels <subcommand>

Subcommands:
  list     List the active config's panels: id, display name, stored item
           count, and sources

Panel ids are what the \`panel:\` search operator, /api/search's ?panel=
parameter, per-panel feeds (/api/panels/<id>.rss), and the refresh routes
all resolve. Panels whose source is "all" span every configured source.
The items column counts the panel's stored deduped stories in the local
database (0 until a \`pace serve\` refresh has stored some).

Options:
      --json            Emit the panels as JSON ({count, panels} with each
                        panel's id, name, items, sources, and all flag)
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -P, --preset <name>   Use a bundled preset config
  -C, --chdir <dir>     Change to directory (for config/data loads)
`;
}

/** One panel of the active layout, as `pace panels list` reports it. */
export interface PanelsListRow {
  /** Resolved panel id — the one panel: / ?panel= / /api/panels/<id> accept. */
  id: string;
  /** Display name (the layout's `panel:` title). */
  name: string;
  /** Stored deduped item count for the panel (0 when nothing is stored yet). */
  items: number;
  /** Resolved source names feeding the panel (adapter/pipeline names). */
  sources: string[];
  /** True when the panel's source is "all" (spans every configured source). */
  isAll: boolean;
}

/**
 * Collect the active config's panels in layout order, resolving ids and
 * source names through the same `buildLayoutRuntimeMaps` the server and the
 * `panel:` search operator use — so the listed ids are exactly the ones every
 * panel-scoped surface accepts. `counts` maps panel ids to their stored
 * deduped item counts (see countDedupedItemsByPanel); panels absent from the
 * map report 0. Throws when the layout has no panels.
 */
export function collectPanelsList(
  config: AppConfig,
  counts: ReadonlyMap<string, number> = new Map(),
): PanelsListRow[] {
  const maps = buildLayoutRuntimeMaps(
    config.layout,
    config.adapters.map(getAdapterName),
    config.pipelines,
  );
  if (maps.dashboardPanels.length === 0) {
    throw new Error("panels: config has no panels in its layout");
  }
  return maps.dashboardPanels.map(({ panel, pid, isAll }) => ({
    id: pid,
    name: panel.panel,
    items: counts.get(pid) ?? 0,
    sources: maps.panelIdToRefreshSourceNames.get(pid) ?? [],
    isAll,
  }));
}

/**
 * Render the rows as aligned columns: id, display name, right-aligned stored
 * item count, then the resolved source names ("(all sources)" prefixes the
 * list for source: all panels, since those follow every configured adapter
 * and pipeline).
 */
export function formatPanelsList(rows: readonly PanelsListRow[]): string {
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const itemsWidth = Math.max(...rows.map((row) => String(row.items).length));
  return rows
    .map((row) => {
      const sources = row.isAll
        ? `(all sources) ${row.sources.join(", ")}`.trimEnd()
        : row.sources.join(", ");
      const items = String(row.items).padStart(itemsWidth);
      return `${row.id.padEnd(idWidth)}  ${row.name.padEnd(nameWidth)}  ${items}  ${sources}`.trimEnd();
    })
    .join("\n");
}

/**
 * The whole listing as pretty-printed JSON for `--json`: {count, panels} with
 * each panel's id, display name, stored item count, resolved source names,
 * and an `all` flag for source: all panels — the row shape verbatim except
 * `isAll` exposed as `all` (JSON consumers should not inherit an internal
 * naming quirk). Always a parseable document, mirroring `pace search --json`.
 */
export function formatPanelsJson(rows: readonly PanelsListRow[]): string {
  const panels = rows.map(({ id, name, items, sources, isAll }) => ({
    id,
    name,
    items,
    sources,
    all: isAll,
  }));
  return JSON.stringify({ count: rows.length, panels }, null, 2);
}

/** Stderr summary line, keeping stdout clean for piping ids into scripts. */
export function formatPanelsSummary(rows: readonly PanelsListRow[]): string {
  const items = rows.reduce((sum, row) => sum + row.items, 0);
  return `panels: ${rows.length} panel${rows.length === 1 ? "" : "s"}, ${items} stored item${items === 1 ? "" : "s"}`;
}
