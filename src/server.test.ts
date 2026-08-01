import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { initDb, saveItems } from "./db";
import { securityHeadersMiddleware } from "./server/security-headers";
import type { ServerRouteDeps } from "./server/routes";
import type { RefreshResult } from "./refresh-result";
import type { RefreshHealth } from "./scheduler-runtime";
import { singlePanelLayout, testAppLayout } from "./test/app-config";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import { makeContentItem as makeItem } from "./test/content-items";
import { installTempDbHooks } from "./test/temp-db";
import {
  createTestServerApp,
  BROWSER_NAVIGATION_HEADERS,
  expectDashboardFooterUtc,
  expectDashboardHtmlShell,
  expectDashboardItemTitle,
  expectDashboardPanelHeading,
  expectDashboardRefreshAction,
  expectHtmlOk,
  expectSecurityHeaders,
  expectRefreshPanelFailure,
  expectRefreshPanelNotFound,
  expectRefreshPanelRedirect,
  makeServerRouteDeps,
  requestDashboard,
  requestRefreshPanel,
  requestServerRoute,
} from "./test/server-harness";

describe("securityHeadersMiddleware", () => {
  test("applies standard security headers to responses", async () => {
    const app = new Hono();
    app.use("*", securityHeadersMiddleware());
    app.get("/probe", (c) => c.text("ok"));

    const res = await app.request("/probe");

    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });
});

describe("GET / dashboard", () => {
  installTempDbHooks({ prefix: "pace-server-dash-" });

  test("returns HTML shell with security headers and UTC footer", async () => {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const res = await requestDashboard(app);

    expectHtmlOk(res);
    const html = await res.text();
    expectDashboardHtmlShell(html);
    expectDashboardFooterUtc(html);
    expectSecurityHeaders(res);
  });

  test("renders panel items loaded from database", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({
        id: "t1",
        title: "HN Story",
        url: "https://news.ycombinator.com/item",
        source: "hackernews",
      }),
    ]);

    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const res = await requestDashboard(app);
    const html = await res.text();

    expectDashboardPanelHeading(html, "Tech");
    expectDashboardItemTitle(html, "HN Story");
    expect(html).toContain('href="https://news.ycombinator.com/item"');
    expect(html).toContain('<span class="item-source src-hn">hackernews</span>');
    expectDashboardRefreshAction(html, "tech-panel");
  });

  test("shows degraded source notice with cached content and clears it after recovery", async () => {
    initDb();
    saveItems("incidents-panel", [
      makeItem({
        id: "incident-1",
        title: "Cached incident report",
        source: "incidents",
      }),
    ]);

    let health: RefreshHealth = {
      status: "degraded",
      sources: [{
        kind: "adapter",
        name: "incidents",
        status: "failing",
        lastError: "rss: failed to fetch: HTTP 503",
        lastSuccessAt: "2026-07-12T12:00:00.000Z",
        lastFailureAt: "2026-07-12T12:05:00.000Z",
      }],
    };
    const layout = testAppLayout(
      singlePanelLayout("Incidents", "incidents", { id: "incidents-panel" }),
    );
    const app = createTestServerApp(makeServerRouteDeps({
      layout,
      getRefreshHealth: () => health,
    }));

    const degradedHtml = await (await requestDashboard(app)).text();
    expectDashboardItemTitle(degradedHtml, "Cached incident report");
    expect(degradedHtml).toContain("refresh-notice refresh-notice-error");
    expect(degradedHtml).toContain(
      "Refresh failed for incidents — check server logs; showing existing data.",
    );
    expect(degradedHtml).not.toContain("HTTP 503");

    health = {
      status: "ok",
      sources: [{ kind: "adapter", name: "incidents", status: "ok" }],
    };
    const recoveredHtml = await (await requestDashboard(app)).text();
    expectDashboardItemTitle(recoveredHtml, "Cached incident report");
    expect(recoveredHtml).not.toContain("refresh-notice");
  });

  test("renders multiple panels via loadDashboardPanelDataMap", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", title: "Tech Item" })]);
    saveItems("other-panel", [makeItem({ id: "o1", title: "Other Item" })]);

    const layout = flexCfg("row", [
      panelCfg("Tech", "hackernews", { id: "tech-panel" }),
      panelCfg("Other", "reddit", { id: "other-panel" }),
    ]);
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const res = await requestDashboard(app);
    const html = await res.text();

    expectDashboardPanelHeading(html, "Tech");
    expectDashboardPanelHeading(html, "Other");
    expectDashboardItemTitle(html, "Tech Item");
    expectDashboardItemTitle(html, "Other Item");
  });

  test("all panel includes items from every saved panel", async () => {
    initDb();
    saveItems("a-panel", [makeItem({ id: "a1", title: "Alpha", url: "https://alpha.test/a1" })]);
    saveItems("b-panel", [makeItem({ id: "b1", title: "Beta", url: "https://beta.test/b1" })]);

    const layout = testAppLayout(singlePanelLayout("Everything", "all"));
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const res = await requestDashboard(app);
    const html = await res.text();

    expectDashboardPanelHeading(html, "Everything");
    expectDashboardItemTitle(html, "Alpha");
    expectDashboardItemTitle(html, "Beta");
  });
});

describe("GET /health", () => {
  test("returns bare ok payload when no refresh-health provider is wired", async () => {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews"));
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const res = await requestServerRoute(app, "/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("reports ok with per-source detail when all sources are healthy", async () => {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews"));
    const app = createTestServerApp(
      makeServerRouteDeps({
        layout,
        getRefreshHealth: () => ({
          status: "ok",
          sources: [
            { kind: "adapter", name: "hackernews", status: "ok", lastSuccessAt: "2026-07-08T00:00:00.000Z" },
          ],
        }),
      }),
    );
    const res = await requestServerRoute(app, "/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      sources: [
        { kind: "adapter", name: "hackernews", status: "ok", lastSuccessAt: "2026-07-08T00:00:00.000Z" },
      ],
    });
  });

  test("stays HTTP 200 but reports degraded with failing source detail", async () => {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews"));
    const app = createTestServerApp(
      makeServerRouteDeps({
        layout,
        getRefreshHealth: () => ({
          status: "degraded",
          sources: [
            {
              kind: "adapter",
              name: "hackernews",
              status: "failing",
              lastError: "HTTP 503",
              lastFailureAt: "2026-07-08T00:05:00.000Z",
            },
          ],
        }),
      }),
    );
    const res = await requestServerRoute(app, "/health");

    // Liveness stays 200 - the server is up and serving cached data.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; sources: Array<{ status: string; lastError?: string }> };
    expect(body.status).toBe("degraded");
    expect(body.sources[0]?.status).toBe("failing");
    expect(body.sources[0]?.lastError).toBe("HTTP 503");
  });
});

describe("handleRefreshPanel", () => {
  function makeRefreshDeps(
    overrides: Partial<ServerRouteDeps> & Pick<ServerRouteDeps, "panelNameToId" | "panelIdToRefreshSourceNames">,
  ): ServerRouteDeps {
    return makeServerRouteDeps({
      layout: testAppLayout(singlePanelLayout("tech", "hackernews")),
      ...overrides,
    });
  }

  test("returns 404 for unknown panel", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["tech", "panel-1"]]),
      panelIdToRefreshSourceNames: new Map([["panel-1", ["hackernews"]]]),
    });

    const res = await requestRefreshPanel(createTestServerApp(deps), "missing-panel");
    await expectRefreshPanelNotFound(res, "missing-panel");
  });

  test("returns 502 when refresh reports failures", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["reddit", "reddit-panel"]]),
      panelIdToRefreshSourceNames: new Map([["reddit-panel", ["reddit"]]]),
      refreshSources: async () =>
        [{ kind: "adapter", name: "reddit", status: "failed", error: "boom" }] satisfies RefreshResult[],
    });

    const res = await requestRefreshPanel(createTestServerApp(deps), "reddit");
    await expectRefreshPanelFailure(res, [
      { kind: "adapter", name: "reddit", status: "failed", error: "boom" },
    ]);
  });

  test("redirects browser navigations on successful refresh", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["tech", "tech-panel"]]),
      panelIdToRefreshSourceNames: new Map([["tech-panel", ["hackernews"]]]),
      refreshSources: async () =>
        [{ kind: "adapter", name: "hackernews", status: "ok" }] satisfies RefreshResult[],
    });

    const res = await requestRefreshPanel(
      createTestServerApp(deps),
      "tech",
      BROWSER_NAVIGATION_HEADERS,
    );
    expectRefreshPanelRedirect(res);
  });

  test("gives non-browser clients a success confirmation body", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["tech", "tech-panel"]]),
      panelIdToRefreshSourceNames: new Map([["tech-panel", ["hackernews", "lobsters"]]]),
      refreshSources: async () =>
        [
          { kind: "adapter", name: "hackernews", status: "ok" },
          { kind: "adapter", name: "lobsters", status: "ok" },
        ] satisfies RefreshResult[],
    });

    const res = await requestRefreshPanel(createTestServerApp(deps), "tech");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe("Refreshed hackernews, lobsters.");
  });

  test("redirects browser navigations when panel has no refresh sources", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["empty", "empty-panel"]]),
      panelIdToRefreshSourceNames: new Map([["empty-panel", []]]),
      refreshSources: async () => {
        throw new Error("refreshSources should not run");
      },
    });

    const res = await requestRefreshPanel(
      createTestServerApp(deps),
      "empty",
      BROWSER_NAVIGATION_HEADERS,
    );
    expectRefreshPanelRedirect(res);
  });

  test("tells non-browser clients when a panel has nothing to refresh", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["empty", "empty-panel"]]),
      panelIdToRefreshSourceNames: new Map([["empty-panel", []]]),
      refreshSources: async () => {
        throw new Error("refreshSources should not run");
      },
    });

    const res = await requestRefreshPanel(createTestServerApp(deps), "empty");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Nothing to refresh for this panel.");
  });
});
