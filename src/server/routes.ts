import type { Context, Hono } from "hono";
import type { DashboardPanel, LayoutNodeConfig } from "../layout/types";
import { loadDashboardPanelDataMap } from "../db";
import { formatDashboardUpdatedAt, renderDashboard } from "../layout";
import {
  collectRefreshFailures,
  collectRefreshSkips,
  formatRefreshPanelFailureBody,
  formatRefreshSkippedNotice,
  type RefreshResult,
} from "../refresh-result";
import {
  formatUnknownRefreshPanelBody,
  resolveRefreshPanelBinding,
} from "./refresh-panel";

export type RefreshSourcesFn = (sourceNames: string[]) => Promise<RefreshResult[]>;

export type ServerRouteDeps = {
  layout: LayoutNodeConfig;
  dashboardPanels: DashboardPanel[];
  panelNameToId: Map<string, string>;
  panelIdToRefreshSourceNames: Map<string, string[]>;
  refreshSources: RefreshSourcesFn;
  basePath: string;
};

export async function handleRefreshPanel(c: Context, deps: ServerRouteDeps): Promise<Response> {
  const param = c.req.param("panel")!; // route pattern /refresh/:panel guarantees presence
  const binding = resolveRefreshPanelBinding(
    param,
    deps.panelNameToId,
    deps.panelIdToRefreshSourceNames,
  );
  if (!binding.ok) return c.text(formatUnknownRefreshPanelBody(binding.param), 404);

  if (binding.sourceNames.length > 0) {
    const results = await deps.refreshSources(binding.sourceNames);
    const failures = collectRefreshFailures(results);
    if (failures.length > 0) {
      return c.text(formatRefreshPanelFailureBody(failures), 502);
    }
    const skips = collectRefreshSkips(results);
    if (skips.length > 0) {
      const names = skips.map((result) => result.name).join(",");
      return c.redirect(
        `${deps.basePath}/?skipped=${encodeURIComponent(names)}`,
        303,
      );
    }
  }

  return c.redirect(deps.basePath + "/", 303);
}

/**
 * Resolve the `?skipped=` query param into a dashboard notice, keeping only
 * names that are actually configured refresh sources (the param is
 * user-controllable, so unknown names are dropped).
 */
export function resolveSkippedNotice(
  skippedParam: string | undefined,
  panelIdToRefreshSourceNames: ReadonlyMap<string, string[]>,
): string | undefined {
  if (!skippedParam) return undefined;
  const known = new Set<string>();
  for (const names of panelIdToRefreshSourceNames.values()) {
    for (const name of names) known.add(name);
  }
  const names = skippedParam
    .split(",")
    .map((name) => name.trim())
    .filter((name) => known.has(name));
  if (names.length === 0) return undefined;
  return formatRefreshSkippedNotice(names);
}

export function registerServerRoutes(app: Hono, deps: ServerRouteDeps): void {
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/", async (c) => {
    const panelData = loadDashboardPanelDataMap(deps.dashboardPanels);

    const content = renderDashboard({
      layout: deps.layout,
      panelData,
      updatedAt: formatDashboardUpdatedAt(),
      basePath: deps.basePath,
      notice: resolveSkippedNotice(
        c.req.query("skipped"),
        deps.panelIdToRefreshSourceNames,
      ),
    });
    return c.html(content);
  });

  app.post("/refresh/:panel", (c) => handleRefreshPanel(c, deps));
}