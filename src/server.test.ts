import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { initDb, saveItems } from "./db";
import { validateParsedConfig } from "./config-validate";
import { DEFAULT_LAYOUT } from "./config/domain";
import { autoMarkSeenDisabled, itemAutoMarkSeenDisabled, itemHiddenBySeen, THEME_COLORS } from "./dashboard.js";
import { renderDashboard } from "./layout";
import { MANIFEST_CONTENT_TYPE } from "./server/manifest";
import { serviceWorkerScript, SW_CACHE_PREFIX, SW_CACHE_VERSION, SW_CONTENT_TYPE } from "./server/sw";
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

describe("server.auto_mark_seen (mark-on-open opt-out)", () => {
  installTempDbHooks({ prefix: "pace-server-autoseen-" });

  function makeApp(autoMarkSeen?: boolean) {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));
    return createTestServerApp(makeServerRouteDeps({ layout, autoMarkSeen }));
  }

  test("accepts booleans and rejects everything else", () => {
    const base = { adapters: [], layout: DEFAULT_LAYOUT };
    expect(validateParsedConfig({ ...base, server: { auto_mark_seen: false } }, DEFAULT_LAYOUT).server)
      .toEqual({ auto_mark_seen: false });
    expect(validateParsedConfig({ ...base, server: { auto_mark_seen: true } }, DEFAULT_LAYOUT).server)
      .toEqual({ auto_mark_seen: true });
    for (const bad of ["false", 0, null, []]) {
      expect(() =>
        validateParsedConfig({ ...base, server: { auto_mark_seen: bad } }, DEFAULT_LAYOUT),
      ).toThrow(/server\.auto_mark_seen must be a boolean/);
    }
  });

  test("dashboard body carries no data-auto-seen by default (mark-on-open stays on)", async () => {
    for (const app of [makeApp(), makeApp(true)]) {
      const html = await (await requestDashboard(app)).text();
      expect(html).not.toContain("data-auto-seen");
    }
  });

  test("autoMarkSeen: false stamps data-auto-seen=\"off\" on the dashboard body", async () => {
    const html = await (await requestDashboard(makeApp(false))).text();
    expect(html).toContain('<body data-auto-seen="off"');
  });

  test("per-panel auto_mark_seen: validates as an optional boolean panel field", () => {
    const base = { adapters: [] };
    const layoutWith = (auto_mark_seen: unknown) => ({
      direction: "row",
      children: [{ panel: "Tech", source: "all", auto_mark_seen }],
    });
    for (const ok of [true, false]) {
      const validated = validateParsedConfig({ ...base, layout: layoutWith(ok) }, DEFAULT_LAYOUT);
      expect((validated.layout as { children: { auto_mark_seen?: boolean }[] }).children[0]!.auto_mark_seen).toBe(ok);
    }
    for (const bad of ["false", 0, null, []]) {
      expect(() =>
        validateParsedConfig({ ...base, layout: layoutWith(bad) }, DEFAULT_LAYOUT),
      ).toThrow(/layout\.children\[0\]\.auto_mark_seen must be a boolean/);
    }
  });

  test("per-panel auto_mark_seen stamps data-auto-seen on that panel only", async () => {
    const layout = {
      direction: "row" as const,
      children: [
        { panel: "Manual", source: "hackernews", id: "manual-panel", auto_mark_seen: false },
        { panel: "Auto", source: "hackernews", id: "auto-panel", auto_mark_seen: true },
        { panel: "Default", source: "hackernews", id: "default-panel" },
      ],
    };
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const html = await (await requestDashboard(app)).text();
    expect(html).toMatch(/data-panel-id="manual-panel"[^>]*data-auto-seen="off"/);
    expect(html).toMatch(/data-panel-id="auto-panel"[^>]*data-auto-seen="on"/);
    expect(html).not.toMatch(/data-panel-id="default-panel"[^>]*data-auto-seen/);
  });

  test("itemAutoMarkSeenDisabled: panel stamp wins over the body, absent stamp falls back", () => {
    const bodyOff = { getAttribute: (n: string) => (n === "data-auto-seen" ? "off" : null) };
    const bodyDefault = { getAttribute: () => null };
    const itemIn = (panelAttr: string | null) => ({
      closest: (sel: string) =>
        sel === ".panel[data-auto-seen]" && panelAttr !== null
          ? { getAttribute: (n: string) => (n === "data-auto-seen" ? panelAttr : null) }
          : null,
    });
    // Panel "off" disables even when the page default is on.
    expect(itemAutoMarkSeenDisabled(itemIn("off"), bodyDefault)).toBe(true);
    // Panel "on" re-enables even when the body is stamped off.
    expect(itemAutoMarkSeenDisabled(itemIn("on"), bodyOff)).toBe(false);
    // No panel stamp: body decides.
    expect(itemAutoMarkSeenDisabled(itemIn(null), bodyOff)).toBe(true);
    expect(itemAutoMarkSeenDisabled(itemIn(null), bodyDefault)).toBe(false);
    // Non-DOM-shaped item falls back to the body too.
    expect(itemAutoMarkSeenDisabled(null, bodyOff)).toBe(true);
    expect(itemAutoMarkSeenDisabled(undefined, bodyDefault)).toBe(false);
  });

  test("autoMarkSeenDisabled reads exactly the server-stamped attribute", () => {
    const bodyWith = { getAttribute: (n: string) => (n === "data-auto-seen" ? "off" : null) };
    const bodyWithout = { getAttribute: () => null };
    expect(autoMarkSeenDisabled(bodyWith)).toBe(true);
    expect(autoMarkSeenDisabled(bodyWithout)).toBe(false);
    expect(autoMarkSeenDisabled(null)).toBe(false);
    expect(autoMarkSeenDisabled(undefined)).toBe(false);
  });
});

describe("server.hide_seen (first-visit hide-seen default)", () => {
  installTempDbHooks({ prefix: "pace-server-hideseen-" });

  function makeApp(hideSeenDefault?: boolean) {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));
    return createTestServerApp(makeServerRouteDeps({ layout, hideSeenDefault }));
  }

  test("accepts booleans and rejects everything else", () => {
    const base = { adapters: [], layout: DEFAULT_LAYOUT };
    for (const ok of [true, false]) {
      expect(validateParsedConfig({ ...base, server: { hide_seen: ok } }, DEFAULT_LAYOUT).server)
        .toEqual({ hide_seen: ok });
    }
    for (const bad of ["true", 1, null, []]) {
      expect(() =>
        validateParsedConfig({ ...base, server: { hide_seen: bad } }, DEFAULT_LAYOUT),
      ).toThrow(/server\.hide_seen must be a boolean/);
    }
  });

  test("dashboard body carries no data-hide-seen by default (seen items stay visible)", async () => {
    for (const app of [makeApp(), makeApp(false)]) {
      const html = await (await requestDashboard(app)).text();
      expect(html).not.toContain("data-hide-seen");
    }
  });

  test("hideSeenDefault: true stamps data-hide-seen=\"on\" on the dashboard body", async () => {
    const html = await (await requestDashboard(makeApp(true))).text();
    expect(html).toContain('<body data-hide-seen="on"');
  });

  test("per-panel hide_seen: validates as an optional boolean panel field", () => {
    const base = { adapters: [] };
    const layoutWith = (hide_seen: unknown) => ({
      direction: "row",
      children: [{ panel: "Tech", source: "all", hide_seen }],
    });
    for (const ok of [true, false]) {
      const validated = validateParsedConfig({ ...base, layout: layoutWith(ok) }, DEFAULT_LAYOUT);
      expect((validated.layout as { children: { hide_seen?: boolean }[] }).children[0]!.hide_seen).toBe(ok);
    }
    for (const bad of ["false", 0, null, []]) {
      expect(() =>
        validateParsedConfig({ ...base, layout: layoutWith(bad) }, DEFAULT_LAYOUT),
      ).toThrow(/layout\.children\[0\]\.hide_seen must be a boolean/);
    }
  });

  test("per-panel hide_seen stamps data-hide-seen on that panel only", async () => {
    const layout = {
      direction: "row" as const,
      children: [
        { panel: "To read", source: "hackernews", id: "toread-panel", hide_seen: false },
        { panel: "Firehose", source: "hackernews", id: "firehose-panel", hide_seen: true },
        { panel: "Default", source: "hackernews", id: "default-panel" },
      ],
    };
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const html = await (await requestDashboard(app)).text();
    expect(html).toMatch(/data-panel-id="toread-panel"[^>]*data-hide-seen="off"/);
    expect(html).toMatch(/data-panel-id="firehose-panel"[^>]*data-hide-seen="on"/);
    expect(html).not.toMatch(/data-panel-id="default-panel"[^>]*data-hide-seen/);
  });

  test("itemHiddenBySeen: panel stamp wins over the mode, absent stamp follows it", () => {
    const itemIn = (panelAttr: string | null, seen = true) => ({
      classList: { contains: (cls: string) => cls === "item-seen" && seen },
      closest: (sel: string) =>
        sel === ".panel[data-hide-seen]" && panelAttr !== null
          ? { getAttribute: (n: string) => (n === "data-hide-seen" ? panelAttr : null) }
          : null,
    });
    // Panel "on" hides its seen items even while the mode is off.
    expect(itemHiddenBySeen(itemIn("on"), false)).toBe(true);
    // Panel "off" keeps its seen items visible even while the mode is on.
    expect(itemHiddenBySeen(itemIn("off"), true)).toBe(false);
    // No panel stamp: the page-wide mode decides.
    expect(itemHiddenBySeen(itemIn(null), true)).toBe(true);
    expect(itemHiddenBySeen(itemIn(null), false)).toBe(false);
    // Unseen items are never hidden, override or not.
    expect(itemHiddenBySeen(itemIn("on", false), true)).toBe(false);
    // Non-DOM-shaped input is never hidden.
    expect(itemHiddenBySeen(null, true)).toBe(false);
    expect(itemHiddenBySeen(undefined, true)).toBe(false);
  });
});

describe("GET /favicon.svg", () => {
  installTempDbHooks({ prefix: "pace-server-favicon-" });

  function makeApp(basePath = "") {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));
    return createTestServerApp(makeServerRouteDeps({ layout, basePath }));
  }

  test("serves the plain pace monogram as cacheable SVG", async () => {
    const res = await requestServerRoute(makeApp(), "/favicon.svg");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const svg = await res.text();
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(">p</text>");
    // The unread dot is client-side only; the served asset never carries it.
    expect(svg).not.toContain("<circle");
  });

  test("is served under the base path and linked from the dashboard head", async () => {
    const app = makeApp("/pace");

    const res = await requestServerRoute(app, "/pace/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");

    const html = await (await requestServerRoute(app, "/pace")).text();
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/pace/favicon.svg"');
  });
});

describe("GET /manifest.webmanifest", () => {
  installTempDbHooks({ prefix: "pace-server-manifest-" });

  function makeApp(basePath = "") {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));
    return createTestServerApp(makeServerRouteDeps({ layout, basePath }));
  }

  test("serves an installable web app manifest matching the served icon and theme", async () => {
    const res = await requestServerRoute(makeApp(), "/manifest.webmanifest");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(MANIFEST_CONTENT_TYPE);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const manifest = await res.json();
    expect(manifest.name).toBe("pace");
    expect(manifest.short_name).toBe("pace");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.id).toBe("/");
    // Splash/window chrome colors stay in lockstep with the theme-color metas.
    expect(manifest.theme_color).toBe(THEME_COLORS.dark);
    expect(manifest.background_color).toBe(THEME_COLORS.dark);
    expect(manifest.icons).toEqual([
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ]);
  });

  test("scopes id/start_url/icon under the base path and is linked from the dashboard head", async () => {
    const app = makeApp("/pace");

    const res = await requestServerRoute(app, "/pace/manifest.webmanifest");
    expect(res.status).toBe(200);
    const manifest = await res.json();
    expect(manifest.start_url).toBe("/pace/");
    expect(manifest.scope).toBe("/pace/");
    expect(manifest.id).toBe("/pace/");
    expect(manifest.icons[0].src).toBe("/pace/favicon.svg");

    const html = await (await requestServerRoute(app, "/pace")).text();
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('href="/pace/manifest.webmanifest"');
  });

  test("static exports never link a manifest (self-contained files have no server)", () => {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));
    const html = renderDashboard({
      layout,
      panelData: new Map(),
      updatedAt: "now",
      mode: "static",
    });
    expect(html).not.toContain('rel="manifest"');
  });
});

describe("GET /sw.js", () => {
  installTempDbHooks({ prefix: "pace-server-sw-" });

  function makeApp(basePath = "") {
    const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));
    return createTestServerApp(makeServerRouteDeps({ layout, basePath }));
  }

  test("serves the offline service worker with prompt-update caching", async () => {
    const res = await requestServerRoute(makeApp(), "/sw.js");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(SW_CONTENT_TYPE);
    // no-cache so browsers revalidate and pick up worker updates promptly.
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = await res.text();
    expect(body).toBe(serviceWorkerScript(""));
    // The precached app shell covers everything an offline reload needs.
    for (const url of ["\"/\"", "\"/styles.css\"", "\"/dashboard.js\"", "\"/favicon.svg\"", "\"/manifest.webmanifest\""]) {
      expect(body).toContain(url);
    }
    // Network-first: the live server always wins; the cache is a fallback.
    expect(body).toContain("fetch(request)");
    expect(body).toContain("caches.match(request)");
    expect(body).toContain(SW_CACHE_PREFIX + SW_CACHE_VERSION);
  });

  test("scopes the app shell under the base path", async () => {
    const res = await requestServerRoute(makeApp("/pace"), "/pace/sw.js");

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(serviceWorkerScript("/pace"));
    expect(body).toContain('const ROOT = "/pace"');
    for (const url of ["\"/pace/styles.css\"", "\"/pace/dashboard.js\"", "\"/pace/favicon.svg\"", "\"/pace/manifest.webmanifest\""]) {
      expect(body).toContain(url);
    }
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
