import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { initDb, saveItems } from "./db";
import { securityHeadersMiddleware } from "./server/security-headers";
import type { ServerRouteDeps } from "./server/routes";
import type { RefreshResult } from "./refresh-result";
import { singlePanelLayout, testAppLayout } from "./test/app-config";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import { makeContentItem as makeItem } from "./test/content-items";
import { installTempDbHooks } from "./test/temp-db";
import {
  createTestServerApp,
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
  test("returns ok JSON payload", async () => {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews"));
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const res = await requestServerRoute(app, "/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ status: "ok" });
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

  test("redirects on successful refresh", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["tech", "tech-panel"]]),
      panelIdToRefreshSourceNames: new Map([["tech-panel", ["hackernews"]]]),
      refreshSources: async () =>
        [{ kind: "adapter", name: "hackernews", status: "ok" }] satisfies RefreshResult[],
    });

    const res = await requestRefreshPanel(createTestServerApp(deps), "tech");
    expectRefreshPanelRedirect(res);
  });

  test("redirects when panel has no refresh sources", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["empty", "empty-panel"]]),
      panelIdToRefreshSourceNames: new Map([["empty-panel", []]]),
      refreshSources: async () => {
        throw new Error("refreshSources should not run");
      },
    });

    const res = await requestRefreshPanel(createTestServerApp(deps), "empty");
    expectRefreshPanelRedirect(res);
  });
});