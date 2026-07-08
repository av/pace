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

/**
 * Cross-site request guard for the state-changing refresh endpoint.
 *
 * pace is a localhost-first dashboard with no auth, so a malicious page could
 * otherwise fire `POST http://localhost:3000/refresh/...` form posts at it
 * (harm is limited to triggering refreshes, but it can hammer upstream
 * sources). Browsers always attach `Sec-Fetch-Site` and/or `Origin` to
 * cross-origin POSTs, so rejecting on those catches the CSRF case while
 * header-less non-browser clients (curl, scripts) stay allowed.
 *
 * Returns a rejection reason, or null when the request is trusted.
 */
export function resolveCrossSiteRefreshRejection(
  headers: { get(name: string): string | null },
): string | null {
  const secFetchSite = headers.get("sec-fetch-site")?.toLowerCase();
  // "none" = user-initiated (address bar etc.); absent = non-browser client.
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return `cross-site request rejected (Sec-Fetch-Site: ${secFetchSite})`;
  }
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return "cross-site request rejected (malformed Origin header)";
    }
    const host = headers.get("host");
    if (host && originHost !== host) {
      return `cross-site request rejected (Origin host ${originHost} does not match ${host})`;
    }
  } else if (origin === "null") {
    return "cross-site request rejected (opaque Origin)";
  }
  return null;
}

export async function handleRefreshPanel(c: Context, deps: ServerRouteDeps): Promise<Response> {
  const rejection = resolveCrossSiteRefreshRejection(c.req.raw.headers);
  if (rejection) return c.text(`Forbidden: ${rejection}\n`, 403);

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
      return c.redirect(
        `${deps.basePath}/?skipped=${encodeSkippedNames(skips.map((result) => result.name))}`,
        303,
      );
    }
  }

  return c.redirect(deps.basePath + "/", 303);
}

/**
 * Encode skipped source names for the `?skipped=` query param. Names are
 * free-form (may contain commas), so each name is percent-encoded
 * individually and the encoded parts are joined with literal commas — a
 * comma inside a name stays `%2C` and survives the roundtrip.
 */
export function encodeSkippedNames(names: string[]): string {
  return names.map((name) => encodeURIComponent(name)).join(",");
}

/**
 * Extract a query param's RAW (still percent-encoded) value from a URL.
 * Framework accessors (`c.req.query`) percent-decode once, which would
 * collapse an encoded `%2C` into a literal comma before we can split.
 */
export function rawQueryParam(url: string, key: string): string | undefined {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return undefined;
  const query = url.slice(qIndex + 1).split("#", 1)[0] ?? "";
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const k = eq === -1 ? pair : pair.slice(0, eq);
    if (k === key) return eq === -1 ? "" : pair.slice(eq + 1);
  }
  return undefined;
}

/** Decode one `?skipped=` part; malformed percent-escapes yield null. */
function decodeSkippedName(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/**
 * Resolve the `?skipped=` query param into a dashboard notice, keeping only
 * names that are actually configured refresh sources (the param is
 * user-controllable, so unknown names are dropped).
 *
 * Expects the RAW (still percent-encoded) query value: commas separate
 * names, and each part is percent-decoded individually so names containing
 * commas (`%2C`) roundtrip. Pre-decoded plain names also work, since
 * decoding is a no-op for them.
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
    .map((part) => decodeSkippedName(part.trim()))
    .filter((name): name is string => name !== null && known.has(name));
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
        rawQueryParam(c.req.url, "skipped"),
        deps.panelIdToRefreshSourceNames,
      ),
    });
    return c.html(content);
  });

  app.post("/refresh/:panel", (c) => handleRefreshPanel(c, deps));
}