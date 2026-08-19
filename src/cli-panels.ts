import { buildLayoutRuntimeMaps } from "./layout/domain";
import { getAdapterName } from "./utils";
import type { AppConfig } from "./config/types";

export function formatPanelsUsage(): string {
  return `Usage: pace panels <subcommand>

Subcommands:
  list     List the active config's panels: id, display name, and sources

Panel ids are what the \`panel:\` search operator, /api/search's ?panel=
parameter, per-panel feeds (/api/panels/<id>.rss), and the refresh routes
all resolve. Panels whose source is "all" span every configured source.

Options:
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
  /** Resolved source names feeding the panel (adapter/pipeline names). */
  sources: string[];
  /** True when the panel's source is "all" (spans every configured source). */
  isAll: boolean;
}

/**
 * Collect the active config's panels in layout order, resolving ids and
 * source names through the same `buildLayoutRuntimeMaps` the server and the
 * `panel:` search operator use — so the listed ids are exactly the ones every
 * panel-scoped surface accepts. Throws when the layout has no panels.
 */
export function collectPanelsList(config: AppConfig): PanelsListRow[] {
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
    sources: maps.panelIdToRefreshSourceNames.get(pid) ?? [],
    isAll,
  }));
}

/**
 * Render the rows as aligned columns: id, display name, then the resolved
 * source names ("(all sources)" prefixes the list for source: all panels,
 * since those follow every configured adapter and pipeline).
 */
export function formatPanelsList(rows: readonly PanelsListRow[]): string {
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  return rows
    .map((row) => {
      const sources = row.isAll
        ? `(all sources) ${row.sources.join(", ")}`.trimEnd()
        : row.sources.join(", ");
      return `${row.id.padEnd(idWidth)}  ${row.name.padEnd(nameWidth)}  ${sources}`.trimEnd();
    })
    .join("\n");
}

/** Stderr summary line, keeping stdout clean for piping ids into scripts. */
export function formatPanelsSummary(rows: readonly PanelsListRow[]): string {
  return `panels: ${rows.length} panel${rows.length === 1 ? "" : "s"}`;
}
