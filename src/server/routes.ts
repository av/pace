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
  formatRefreshSuccessBody,
  type RefreshResult,
} from "../refresh-result";
import {
  formatUnknownRefreshPanelBody,
  resolveRefreshPanelBinding,
} from "./refresh-panel";
import type { RefreshHealth } from "../scheduler-runtime";
import { handleApiPanelItems, handleApiPanelList } from "./api-panels";
import { handleApiBrief, handleBriefMarkdown } from "./api-brief";
import type { BriefConfigInfo } from "../brief";
import { handleApiSearch } from "./api-search";
import { handleApiSearchRss } from "./api-search-rss";
import { handleApiPanelRss, RSS_PANEL_SUFFIX } from "./api-panels-rss";
import { handleApiSeenList, handleApiSeenSet } from "./api-seen";
import { handleApiStarList, handleApiStarSet } from "./api-star";
import { handleApiStarRss } from "./api-star-rss";
import { faviconSvg } from "../dashboard.js";
import { MANIFEST_CONTENT_TYPE, webAppManifest } from "./manifest";
import { serviceWorkerScript, SW_CONTENT_TYPE } from "./sw";

export type RefreshSourcesFn = (sourceNames: string[]) => Promise<RefreshResult[]>;

export type ServerRouteDeps = {
  layout: LayoutNodeConfig;
  dashboardPanels: DashboardPanel[];
  panelNameToId: Map<string, string>;
  panelIdToRefreshSourceNames: Map<string, string[]>;
  refreshSources: RefreshSourcesFn;
  basePath: string;
  /**
   * Whether opening an item's title link auto-marks it seen (default true;
   * from server.auto_mark_seen). False renders data-auto-seen="off" on the
   * dashboard <body> so the client keeps read state fully manual.
   */
  autoMarkSeen?: boolean;
  /**
   * Whether the dashboard starts with hide-seen mode on for visitors with no
   * stored preference (default false; from server.hide_seen). True renders
   * data-hide-seen="on" on the dashboard <body>.
   */
  hideSeenDefault?: boolean;
  /**
   * Refresh-health snapshot for /health. Optional so embedders without a
   * scheduler keep the bare liveness payload.
   */
  getRefreshHealth?: () => RefreshHealth;
  /**
   * Config facts for the agent brief (config label, non-feed sources,
   * pipeline names). Optional so embedders and tests without a loaded config
   * still serve a brief with neutral defaults.
   */
  brief?: BriefConfigInfo;
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

  // Every outcome branches the same way: a browser user lands back on the
  // dashboard (with a ?failed=/?skipped= notice where applicable), while
  // non-browser clients (curl, scripts, health checks) get a diagnosable
  // text body instead of an empty 303.
  const isBrowserNav = isBrowserNavigationRequest(c.req.raw.headers);

  if (binding.sourceNames.length > 0) {
    const results = await deps.refreshSources(binding.sourceNames);
    const failures = collectRefreshFailures(results);
    if (failures.length > 0) {
      if (isBrowserNav) {
        return c.redirect(
          `${dashboardRootPath(deps.basePath)}?failed=${encodeSourceNames(failures.map((result) => result.name))}`,
          303,
        );
      }
      return c.text(formatRefreshPanelFailureBody(failures), 502);
    }
    const skips = collectRefreshSkips(results);
    if (skips.length > 0) {
      if (isBrowserNav) {
        return c.redirect(
          `${dashboardRootPath(deps.basePath)}?skipped=${encodeSourceNames(skips.map((result) => result.name))}`,
          303,
        );
      }
      return c.text(formatRefreshSkippedNotice(skips.map((result) => result.name)), 200);
    }
  }

  if (isBrowserNav) {
    return c.redirect(dashboardRootPath(deps.basePath), 303);
  }
  return c.text(formatRefreshSuccessBody(binding.sourceNames), 200);
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

  // Read-only JSON API over the same cached snapshots the dashboard renders,
  // for scripts, widgets, and monitors that want data instead of HTML.
  app.get("/api/panels", (c) => handleApiPanelList(c, deps));
  // The agent brief: what the panels show, windowed, deduped across panels,
  // ranked, and bounded, as versioned JSON or as Markdown for one LLM read.
  app.get("/api/brief", (c) => handleApiBrief(c, deps));
  app.get("/brief.md", (c) => handleBriefMarkdown(c, deps));
  // Server-side search over the stored (deduped) items — reaches everything
  // in the database, not just what the dashboard currently renders.
  app.get("/api/search", (c) => handleApiSearch(c, deps));
  // The same search rendered as RSS 2.0 — any query becomes a subscribable
  // "saved search" feed for regular feed readers.
  app.get(`/api/search${RSS_PANEL_SUFFIX}`, (c) => handleApiSearchRss(c, deps));
  // Seen/read item state: the dashboard's "x" key persists which items the
  // user has read, keyed by dedup identity so duplicates share the mark.
  app.get("/api/seen", (c) => handleApiSeenList(c));
  app.post("/api/seen", (c) => handleApiSeenSet(c));
  // Starred/pinned item state: the dashboard's "s" key persists which items
  // the user wants to keep, sharing the seen marks' dedup identity.
  app.get("/api/star", (c) => handleApiStarList(c));
  app.post("/api/star", (c) => handleApiStarSet(c));
  // The starred items themselves as RSS 2.0 — the reading list built with
  // the "s" key becomes a subscribable feed for regular feed readers.
  app.get(`/api/star${RSS_PANEL_SUFFIX}`, (c) => handleApiStarRss(c, deps));
  // A ".rss" suffix on the panel segment switches the same lookup to an
  // RSS 2.0 rendering, so pace panels can feed regular feed readers.
  app.get("/api/panels/:panel", (c) =>
    c.req.param("panel")!.endsWith(RSS_PANEL_SUFFIX)
      ? handleApiPanelRss(c, deps)
      : handleApiPanelItems(c, deps));

  // The plain pace monogram (no unread dot) as a real asset, so browsers
  // hitting /favicon.svg directly, no-JS visitors, and bookmarks get an icon
  // without the client module; the dashboard swaps its href to the unread-dot
  // data: rendering at runtime.
  app.get("/favicon.svg", (c) =>
    c.body(faviconSvg(0), 200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
    }));

  // Web app manifest, so browsers offer to install the dashboard as a
  // standalone home-screen app. start_url/scope/icon are absolute under the
  // base path so multiple pace instances behind one origin install as
  // distinct apps.
  app.get("/manifest.webmanifest", (c) =>
    c.body(JSON.stringify(webAppManifest(deps.basePath), null, 2), 200, {
      "Content-Type": MANIFEST_CONTENT_TYPE,
      "Cache-Control": "public, max-age=3600",
    }));

  // Service worker for offline last-render viewing: same-origin GETs are
  // served network-first with the cache as fallback, so the installed app
  // (or any tab) still shows the last-rendered dashboard when the server is
  // unreachable. no-cache so browsers pick up worker updates promptly.
  app.get("/sw.js", (c) =>
    c.body(serviceWorkerScript(deps.basePath), 200, {
      "Content-Type": SW_CONTENT_TYPE,
      "Cache-Control": "no-cache",
    }));

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
      autoMarkSeen: deps.autoMarkSeen,
      hideSeenDefault: deps.hideSeenDefault,
    });
    return c.html(content);
  });

  app.post("/refresh/:panel", (c) => handleRefreshPanel(c, deps));
}
