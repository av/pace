import { describe, test, expect } from "bun:test";
import { formatRefreshFailedNotice, type RefreshResult } from "../refresh-result";
import { isBrowserNavigationRequest, resolveFailedNotice } from "./routes";
import { singlePanelLayout, testAppLayout } from "../test/app-config";
import { installTempDbHooks } from "../test/temp-db";
import {
  createTestServerApp,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

describe("isBrowserNavigationRequest", () => {
  const headers = (record: Record<string, string>) => new Headers(record);

  test("true for Sec-Fetch-Mode: navigate (form submit)", () => {
    expect(isBrowserNavigationRequest(headers({ "sec-fetch-mode": "navigate" }))).toBe(true);
  });

  test("false for non-navigate fetch modes", () => {
    expect(isBrowserNavigationRequest(headers({ "sec-fetch-mode": "cors" }))).toBe(false);
    expect(isBrowserNavigationRequest(headers({ "sec-fetch-mode": "no-cors" }))).toBe(false);
  });

  test("falls back to Accept: text/html when Sec-Fetch-Mode is absent", () => {
    expect(
      isBrowserNavigationRequest(headers({ accept: "text/html,application/xhtml+xml" })),
    ).toBe(true);
    expect(isBrowserNavigationRequest(headers({ accept: "application/json" }))).toBe(false);
  });

  test("false for header-less clients (curl)", () => {
    expect(isBrowserNavigationRequest(headers({}))).toBe(false);
  });
});

describe("resolveFailedNotice", () => {
  const sourceMap = new Map([["panel-1", ["hackernews", "reddit"]]]);

  test("builds an error notice for known names", () => {
    expect(resolveFailedNotice("hackernews", sourceMap)).toBe(
      formatRefreshFailedNotice(["hackernews"]),
    );
  });

  test("drops unknown (user-controllable) names", () => {
    expect(resolveFailedNotice("<script>x</script>,reddit", sourceMap)).toBe(
      formatRefreshFailedNotice(["reddit"]),
    );
    expect(resolveFailedNotice("bogus", sourceMap)).toBeUndefined();
    expect(resolveFailedNotice(undefined, sourceMap)).toBeUndefined();
  });
});

describe("failed refresh end-to-end", () => {
  installTempDbHooks({ prefix: "pace-refresh-fail-" });

  function makeDeps(refreshSources: () => Promise<RefreshResult[]>) {
    return makeServerRouteDeps({
      layout: testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" })),
      panelNameToId: new Map([["tech", "tech-panel"]]),
      panelIdToRefreshSourceNames: new Map([["tech-panel", ["hackernews", "reddit"]]]),
      refreshSources,
    });
  }

  const failingDeps = () =>
    makeDeps(async () => [
      { kind: "adapter", name: "hackernews", status: "failed", error: "HTTP error 404" },
    ]);

  test("browser form submit failure redirects to /?failed= instead of dead 502 page", async () => {
    const res = await requestServerRoute(createTestServerApp(failingDeps()), "/refresh/tech", {
      method: "POST",
      headers: { "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin" },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?failed=hackernews");
  });

  test("non-browser clients keep the 502 text body", async () => {
    const res = await requestServerRoute(createTestServerApp(failingDeps()), "/refresh/tech", {
      method: "POST",
    });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Refresh failed for hackernews: HTTP error 404");
  });

  test("browser failure redirect respects basePath", async () => {
    const deps = { ...failingDeps(), basePath: "/pace" };
    const res = await requestServerRoute(createTestServerApp(deps), "/refresh/tech", {
      method: "POST",
      headers: { "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin" },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/pace/?failed=hackernews");
  });

  test("dashboard renders the error banner as role=alert with error class", async () => {
    const app = createTestServerApp(makeDeps(async () => []));
    const res = await requestServerRoute(app, "/?failed=hackernews");
    const html = await res.text();
    expect(html).toContain("refresh-notice refresh-notice-error");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Refresh failed for hackernews");
  });

  test("failed notice wins over skipped when both params are present", async () => {
    const app = createTestServerApp(makeDeps(async () => []));
    const res = await requestServerRoute(app, "/?failed=hackernews&skipped=reddit");
    const html = await res.text();
    expect(html).toContain("Refresh failed for hackernews");
    expect(html).not.toContain("Refresh already in progress");
  });

  test("unknown failed names render no banner and no injection", async () => {
    const app = createTestServerApp(makeDeps(async () => []));
    const res = await requestServerRoute(
      app,
      "/?failed=" + encodeURIComponent("<img src=x onerror=alert(1)>"),
    );
    const html = await res.text();
    expect(html).not.toContain("refresh-notice");
    expect(html).not.toContain("onerror");
  });

  test("skipped notice still renders as role=status without error class", async () => {
    const app = createTestServerApp(makeDeps(async () => []));
    const res = await requestServerRoute(app, "/?skipped=reddit");
    const html = await res.text();
    expect(html).toContain('role="status"');
    expect(html).not.toContain("refresh-notice-error");
  });
});
