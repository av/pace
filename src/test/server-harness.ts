import { expect } from "bun:test";
import type { Hono } from "hono";
import { buildLayoutRuntimeMaps, type LayoutNodeConfig } from "../layout/types";
import { SECURITY_HEADERS } from "../server/security-headers";
import {
  formatRefreshPanelFailureBody,
  type RefreshResult,
} from "../refresh-result";
import { createServerApp } from "../server/app";
import { formatUnknownRefreshPanelBody } from "../server/refresh-panel";
import type { ServerRouteDeps } from "../server/routes";

export function makeServerRouteDeps(
  overrides: Partial<ServerRouteDeps> & { layout: LayoutNodeConfig },
): ServerRouteDeps {
  const { layout, ...rest } = overrides;
  const maps = buildLayoutRuntimeMaps(layout, []);
  return {
    layout,
    dashboardPanels: rest.dashboardPanels ?? maps.dashboardPanels,
    panelNameToId: rest.panelNameToId ?? maps.panelNameToId,
    panelIdToRefreshSourceNames:
      rest.panelIdToRefreshSourceNames ?? maps.panelIdToRefreshSourceNames,
    refreshSources: rest.refreshSources ?? (async () => []),
    basePath: rest.basePath ?? "",
    ...(rest.getRefreshHealth !== undefined && { getRefreshHealth: rest.getRefreshHealth }),
  };
}

export function createTestServerApp(deps: ServerRouteDeps): Hono {
  return createServerApp(deps);
}

export async function requestServerRoute(
  app: Hono,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return app.request(path, init);
}

export async function requestDashboard(app: Hono): Promise<Response> {
  return requestServerRoute(app, "/");
}

export async function requestRefreshPanel(app: Hono, panelParam: string): Promise<Response> {
  return requestServerRoute(app, `/refresh/${panelParam}`, { method: "POST" });
}

type SecurityHeaderSource = Response | Headers | Record<string, string>;

function resolveSecurityHeaderSource(
  headers: SecurityHeaderSource,
): Headers | Record<string, string> {
  return headers instanceof Response ? headers.headers : headers;
}

export function responseHeadersToLowercase(
  headers: SecurityHeaderSource,
): Record<string, string> {
  const source = resolveSecurityHeaderSource(headers);
  const lower: Record<string, string> = {};
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      lower[key.toLowerCase()] = value;
    });
    return lower;
  }
  for (const [key, value] of Object.entries(source)) {
    lower[key.toLowerCase()] = value;
  }
  return lower;
}

/** Assert the standard security header contract from security-headers.ts. */
export function expectSecurityHeaders(headers: SecurityHeaderSource): void {
  const lower = responseHeadersToLowercase(headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(lower[name.toLowerCase()]).toBe(value);
  }
}

export function expectHtmlOk(res: Response): void {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/text\/html/);
}

export function expectDashboardHtmlShell(html: string): void {
  expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(html).toContain("<title>pace</title>");
  expect(html).toContain('<link rel="stylesheet" href="/styles.css"/>');
  expect(html).toContain('<div class="flex-root">');
  expect(html).toContain('<footer class="footer">');
  expect(html).toContain('href="https://github.com/av/pace"');
}

export function expectDashboardFooterUtc(html: string): void {
  expect(html).toMatch(/Pace<\/a> \/ \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
}

export function expectDashboardPanelHeading(html: string, panelName: string): void {
  expect(html).toMatch(new RegExp(`<h2(?:\\s+title="${panelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")?>${panelName}</h2>`));
}

export function expectDashboardItemTitle(html: string, title: string): void {
  expect(html).toContain(`>${title}</`);
}

export function expectDashboardRefreshAction(html: string, panelId: string): void {
  expect(html).toContain(`action="/refresh/${panelId}"`);
}

export async function expectRefreshPanelNotFound(
  res: Response,
  panelParam: string,
): Promise<void> {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe(formatUnknownRefreshPanelBody(panelParam));
}

export async function expectRefreshPanelFailure(
  res: Response,
  failures: ReadonlyArray<RefreshResult>,
): Promise<void> {
  expect(res.status).toBe(502);
  expect(await res.text()).toBe(formatRefreshPanelFailureBody(failures));
}

export function expectRefreshPanelRedirect(res: Response): void {
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
}

/** Live-server refresh may succeed (303) or fail (502) depending on adapter fetch. */
export async function expectRefreshPanelFailureOrRedirect(
  res: Response,
  failureSource: string,
): Promise<void> {
  if (res.status === 303) {
    // May carry ?skipped=<names> when the startup refresh is still running.
    expect(res.headers.get("location") || "").toMatch(/^\/(\?skipped=.+)?$/);
    return;
  }
  expect(res.status).toBe(502);
  expect(await res.text()).toContain(`Refresh failed for ${failureSource}:`);
}