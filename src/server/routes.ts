import type { Context, Hono } from "hono";
import type { DashboardPanel, LayoutNodeConfig } from "../layout/types";
import { loadDashboardPanelDataMap } from "../db";
import { formatDashboardUpdatedAt, renderDashboard } from "../layout";
import {
  collectRefreshFailures,
  collectRefreshSkips,
  formatRefreshFailedNotice,
  formatRefreshPanelFailureBody,
  formatRefreshSkippedNotice,
  type RefreshResult,
} from "../refresh-result";
import {
  formatUnknownRefreshPanelBody,
  resolveRefreshPanelBinding,
} from "./refresh-panel";
import type { RefreshHealth } from "../scheduler-runtime";

export type RefreshSourcesFn = (sourceNames: string[]) => Promise<RefreshResult[]>;

export type ServerRouteDeps = {
  layout: LayoutNodeConfig;
  dashboardPanels: DashboardPanel[];
  panelNameToId: Map<string, string>;
  panelIdToRefreshSourceNames: Map<string, string[]>;
  refreshSources: RefreshSourcesFn;
  basePath: string;
  /**
   * Refresh-health snapshot for /health. Optional so embedders without a
   * scheduler keep the bare liveness payload.
   */
  getRefreshHealth?: () => RefreshHealth;
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

/**
 * True when the request is a browser navigation (form submit / address bar),
 * as opposed to a non-browser client like curl or a script.
 *
 * Browsers attach `Sec-Fetch-Mode: navigate` to form posts; older engines at
 * least send an Accept header preferring text/html. Non-browser clients
 * typically send neither.
 */
export function isBrowserNavigationRequest(
  headers: { get(name: string): string | null },
): boolean {
  const mode = headers.get("sec-fetch-mode")?.toLowerCase();
  if (mode) return mode === "navigate";
  return headers.get("accept")?.toLowerCase().includes("text/html") ?? false;
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
      // A browser user clicking the panel refresh button should land back on
      // the dashboard with an error banner, not on a dead text/plain page.
      // Non-browser clients (curl, scripts, health checks) keep the 502 body.
      if (isBrowserNavigationRequest(c.req.raw.headers)) {
        return c.redirect(
          `${dashboardRootPath(deps.basePath)}?failed=${encodeSourceNames(failures.map((result) => result.name))}`,
          303,
        );
      }
      return c.text(formatRefreshPanelFailureBody(failures), 502);
    }
    const skips = collectRefreshSkips(results);
    if (skips.length > 0) {
      return c.redirect(
        `${dashboardRootPath(deps.basePath)}?skipped=${encodeSourceNames(skips.map((result) => result.name))}`,
        303,
      );
    }
  }

  return c.redirect(dashboardRootPath(deps.basePath), 303);
}

/**
 * Canonical dashboard root for redirects: the base path itself ("/pace"), or
 * "/" when no base path is configured. Redirecting straight to the canonical
 * form avoids a second hop through the trailing-slash 308 canonicalizer.
 */
function dashboardRootPath(basePath: string): string {
  return basePath === "" ? "/" : basePath;
}

/**
 * Encode source names for the `?skipped=` / `?failed=` query params. Names
 * are free-form (may contain commas), so each name is percent-encoded
 * individually and the encoded parts are joined with literal commas — a
 * comma inside a name stays `%2C` and survives the roundtrip.
 */
export function encodeSourceNames(names: string[]): string {
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

/** Decode one query-param part; malformed percent-escapes yield null. */
function decodeSourceName(part: string): string | null {
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
  const names = resolveKnownSourceNames(skippedParam, panelIdToRefreshSourceNames);
  if (names.length === 0) return undefined;
  return formatRefreshSkippedNotice(names);
}

/**
 * Resolve the `?failed=` query param into a dashboard error notice; same
 * validation rules as {@link resolveSkippedNotice}.
 */
export function resolveFailedNotice(
  failedParam: string | undefined,
  panelIdToRefreshSourceNames: ReadonlyMap<string, string[]>,
): string | undefined {
  const names = resolveKnownSourceNames(failedParam, panelIdToRefreshSourceNames);
  if (names.length === 0) return undefined;
  return formatRefreshFailedNotice(names);
}

/** Surface background scheduler failures on the dashboard without exposing raw errors. */
export function resolveRefreshHealthNotice(
  health: RefreshHealth | undefined,
): string | undefined {
  if (health?.status !== "degraded") return undefined;
  const failingNames = health.sources
    .filter((source) => source.status === "failing")
    .map((source) => source.name);
  return failingNames.length > 0 ? formatRefreshFailedNotice(failingNames) : undefined;
}

/** Split, decode, and filter a raw comma-joined name param to configured refresh source names. */
function resolveKnownSourceNames(
  rawParam: string | undefined,
  panelIdToRefreshSourceNames: ReadonlyMap<string, string[]>,
): string[] {
  if (!rawParam) return [];
  const known = new Set<string>();
  for (const names of panelIdToRefreshSourceNames.values()) {
    for (const name of names) known.add(name);
  }
  return rawParam
    .split(",")
    .map((part) => decodeSourceName(part.trim()))
    .filter((name): name is string => name !== null && known.has(name));
}

export function registerServerRoutes(app: Hono, deps: ServerRouteDeps): void {
  // Liveness stays HTTP 200 even when sources are failing — the server is up
  // and serving cached data, and restarting it would not fix a bad upstream.
  // Refresh problems are surfaced in the body ("degraded" + per-source detail)
  // so monitors can alert on content instead of a lying bare "ok".
  app.get("/health", (c) => {
    if (!deps.getRefreshHealth) return c.json({ status: "ok" });
    const refresh = deps.getRefreshHealth();
    return c.json({ status: refresh.status, sources: refresh.sources });
  });

  app.get("/", async (c) => {
    const panelData = loadDashboardPanelDataMap(deps.dashboardPanels);

    const requestedFailureNotice = resolveFailedNotice(
      rawQueryParam(c.req.url, "failed"),
      deps.panelIdToRefreshSourceNames,
    );
    const failedNotice = requestedFailureNotice
      ?? resolveRefreshHealthNotice(deps.getRefreshHealth?.());
    const notice = failedNotice ?? resolveSkippedNotice(
      rawQueryParam(c.req.url, "skipped"),
      deps.panelIdToRefreshSourceNames,
    );
    const content = renderDashboard({
      layout: deps.layout,
      panelData,
      updatedAt: formatDashboardUpdatedAt(),
      basePath: deps.basePath,
      notice,
      noticeTone: failedNotice ? "error" : "info",
    });
    return c.html(content);
  });

  app.post("/refresh/:panel", (c) => handleRefreshPanel(c, deps));
}
