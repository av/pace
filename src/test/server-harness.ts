import { expect } from "bun:test";
import type { Hono } from "hono";
import { buildLayoutRuntimeMaps, type LayoutNodeConfig } from "../layout/types";
import { createServerApp } from "../server/app";
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
  expect(html).toContain(`<h2>${panelName}</h2>`);
}

export function expectDashboardItemTitle(html: string, title: string): void {
  expect(html).toContain(`>${title}</`);
}