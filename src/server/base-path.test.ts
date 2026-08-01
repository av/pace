import { describe, test, expect } from "bun:test";
import { normalizeBasePath } from "../config/domain";
import { singlePanelLayout, testAppLayout } from "../test/app-config";
import { installTempDbHooks } from "../test/temp-db";
import {
  BROWSER_NAVIGATION_HEADERS,
  createTestServerApp,
  expectHtmlOk,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

describe("normalizeBasePath", () => {
  test("empty and undefined normalize to empty string", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
  });

  test("adds leading slash when missing", () => {
    expect(normalizeBasePath("pace")).toBe("/pace");
  });

  test("strips trailing slash", () => {
    expect(normalizeBasePath("/pace/")).toBe("/pace");
  });

  test("trims whitespace", () => {
    expect(normalizeBasePath("  /pace  ")).toBe("/pace");
  });

  test("bare slash normalizes to empty string", () => {
    expect(normalizeBasePath("/")).toBe("");
  });

  test("keeps multi-segment paths intact", () => {
    expect(normalizeBasePath("tools/pace/")).toBe("/tools/pace");
  });
});

describe("server with base_path", () => {
  installTempDbHooks({ prefix: "pace-server-basepath-" });

  const layout = testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }));

  function makeApp(basePath: string) {
    return createTestServerApp(makeServerRouteDeps({ layout, basePath }));
  }

  test("dashboard HTML uses prefixed stylesheet and refresh URLs", async () => {
    const app = makeApp("/pace");
    const res = await requestServerRoute(app, "/");

    expectHtmlOk(res);
    const html = await res.text();
    expect(html).toContain('href="/pace/styles.css"');
    expect(html).toContain('action="/pace/refresh/tech-panel"');
  });

  test("refresh redirects to the prefixed dashboard root", async () => {
    const app = makeApp("/pace");
    const res = await requestServerRoute(app, "/refresh/tech-panel", {
      method: "POST",
      headers: BROWSER_NAVIGATION_HEADERS,
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/pace");
  });

  test("refresh redirects to plain root when no base path configured", async () => {
    const app = makeApp("");
    const res = await requestServerRoute(app, "/refresh/tech-panel", {
      method: "POST",
      headers: BROWSER_NAVIGATION_HEADERS,
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  test("routes are also served under the prefix (non-stripping proxy)", async () => {
    const app = makeApp("/pace");

    const dash = await requestServerRoute(app, "/pace");
    expectHtmlOk(dash);
    expect(await dash.text()).toContain('action="/pace/refresh/tech-panel"');

    const css = await requestServerRoute(app, "/pace/styles.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");

    const health = await requestServerRoute(app, "/pace/health");
    expect(health.status).toBe(200);

    const refresh = await requestServerRoute(app, "/pace/refresh/tech-panel", {
      method: "POST",
      headers: BROWSER_NAVIGATION_HEADERS,
    });
    expect(refresh.status).toBe(303);
    expect(refresh.headers.get("location")).toBe("/pace");
  });

  test("unprefixed routes keep working when a base path is set (stripping proxy)", async () => {
    const app = makeApp("/pace");

    const dash = await requestServerRoute(app, "/");
    expectHtmlOk(dash);

    const css = await requestServerRoute(app, "/styles.css");
    expect(css.status).toBe(200);
  });

  test("trailing-slash prefix root redirects to the prefix root (safety net)", async () => {
    const app = makeApp("/pace");

    // Bare trailing slash — what a reverse proxy typically forwards.
    const bare = await requestServerRoute(app, "/pace/");
    expect(bare.status).toBe(308);
    expect(bare.headers.get("location")).toBe("/pace");

    // Refresh redirects now target the canonical `${basePath}` directly, but
    // the 308 canonicalizer stays as a safety net for external links and
    // proxies; banner query params must survive the hop.
    const banner = await requestServerRoute(app, "/pace/?failed=hn%2Creddit");
    expect(banner.status).toBe(308);
    expect(banner.headers.get("location")).toBe("/pace?failed=hn%2Creddit");
  });

  test("unknown paths under the prefix still 404", async () => {
    const app = makeApp("/pace");
    const res = await requestServerRoute(app, "/pace/nope");
    expect(res.status).toBe(404);
  });
});
