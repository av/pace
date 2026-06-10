import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { securityHeadersMiddleware } from "./server/security-headers";
import { handleRefreshPanel, type ServerRouteDeps } from "./server/routes";
import type { RefreshResult } from "./refresh-result";
import { singlePanelLayout } from "./test/app-config";

function makeRefreshDeps(
  overrides: Partial<ServerRouteDeps> & Pick<ServerRouteDeps, "panelNameToId" | "panelIdToRefreshSourceNames">,
): ServerRouteDeps {
  return {
    layout: singlePanelLayout("tech", "hackernews"),
    dashboardPanels: [],
    refreshSources: async () => [],
    ...overrides,
  };
}

async function invokeRefresh(panelParam: string, deps: ServerRouteDeps): Promise<Response> {
  const app = new Hono();
  app.post("/refresh/:panel", (c) => handleRefreshPanel(c, deps));
  return app.request(`/refresh/${panelParam}`, { method: "POST" });
}

describe("securityHeadersMiddleware", () => {
  test("applies standard security headers to responses", async () => {
    const app = new Hono();
    app.use("*", securityHeadersMiddleware());
    app.get("/probe", (c) => c.text("ok"));

    const res = await app.request("/probe");
    const hd: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      hd[k.toLowerCase()] = v;
    });

    expect(res.status).toBe(200);
    expect(hd["x-content-type-options"]).toBe("nosniff");
    expect(hd["x-frame-options"]).toBe("DENY");
    expect(hd["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(hd["content-security-policy"]).toContain("default-src 'self'");
    expect(hd["permissions-policy"]).toBe("interest-cohort=()");
  });
});

describe("handleRefreshPanel", () => {
  test("returns 404 for unknown panel", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["tech", "panel-1"]]),
      panelIdToRefreshSourceNames: new Map([["panel-1", ["hackernews"]]]),
    });

    const res = await invokeRefresh("missing-panel", deps);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Unknown panel: missing-panel");
  });

  test("returns 502 when refresh reports failures", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["reddit", "reddit-panel"]]),
      panelIdToRefreshSourceNames: new Map([["reddit-panel", ["reddit"]]]),
      refreshSources: async () =>
        [{ kind: "adapter", name: "reddit", status: "failed", error: "boom" }] satisfies RefreshResult[],
    });

    const res = await invokeRefresh("reddit", deps);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Refresh failed for reddit: boom");
  });

  test("redirects on successful refresh", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["tech", "tech-panel"]]),
      panelIdToRefreshSourceNames: new Map([["tech-panel", ["hackernews"]]]),
      refreshSources: async () =>
        [{ kind: "adapter", name: "hackernews", status: "ok" }] satisfies RefreshResult[],
    });

    const res = await invokeRefresh("tech", deps);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  test("redirects when panel has no refresh sources", async () => {
    const deps = makeRefreshDeps({
      panelNameToId: new Map([["empty", "empty-panel"]]),
      panelIdToRefreshSourceNames: new Map([["empty-panel", []]]),
      refreshSources: async () => {
        throw new Error("refreshSources should not run");
      },
    });

    const res = await invokeRefresh("empty", deps);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });
});