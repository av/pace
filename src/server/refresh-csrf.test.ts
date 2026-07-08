import { describe, test, expect } from "bun:test";
import type { RefreshResult } from "../refresh-result";
import { resolveCrossSiteRefreshRejection } from "./routes";
import { singlePanelLayout, testAppLayout } from "../test/app-config";
import { installTempDbHooks } from "../test/temp-db";
import {
  createTestServerApp,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

describe("resolveCrossSiteRefreshRejection", () => {
  const headers = (record: Record<string, string>) => new Headers(record);

  test("allows header-less non-browser clients (curl)", () => {
    expect(resolveCrossSiteRefreshRejection(headers({}))).toBeNull();
  });

  test("allows same-origin and user-initiated fetch metadata", () => {
    expect(
      resolveCrossSiteRefreshRejection(headers({ "sec-fetch-site": "same-origin" })),
    ).toBeNull();
    expect(
      resolveCrossSiteRefreshRejection(headers({ "sec-fetch-site": "none" })),
    ).toBeNull();
    expect(
      resolveCrossSiteRefreshRejection(headers({ "Sec-Fetch-Site": "Same-Origin" })),
    ).toBeNull();
  });

  test("rejects cross-site and same-site fetch metadata", () => {
    expect(
      resolveCrossSiteRefreshRejection(headers({ "sec-fetch-site": "cross-site" })),
    ).toContain("cross-site request rejected");
    expect(
      resolveCrossSiteRefreshRejection(headers({ "sec-fetch-site": "same-site" })),
    ).toContain("cross-site request rejected");
  });

  test("allows matching Origin, rejects mismatched Origin", () => {
    expect(
      resolveCrossSiteRefreshRejection(
        headers({ origin: "http://localhost:3000", host: "localhost:3000" }),
      ),
    ).toBeNull();
    expect(
      resolveCrossSiteRefreshRejection(
        headers({ origin: "http://evil.example", host: "localhost:3000" }),
      ),
    ).toContain("does not match");
  });

  test("rejects opaque and malformed Origin", () => {
    expect(
      resolveCrossSiteRefreshRejection(headers({ origin: "null" })),
    ).toContain("opaque Origin");
    expect(
      resolveCrossSiteRefreshRejection(
        headers({ origin: "not a url", host: "localhost:3000" }),
      ),
    ).toContain("malformed Origin");
  });

  test("Origin without Host header is tolerated (cannot compare)", () => {
    expect(
      resolveCrossSiteRefreshRejection(headers({ origin: "http://localhost:3000" })),
    ).toBeNull();
  });
});

describe("POST /refresh/:panel cross-site guard end-to-end", () => {
  installTempDbHooks({ prefix: "pace-refresh-csrf-" });

  function makeApp(onRefresh: () => void) {
    const refreshSources = async (): Promise<RefreshResult[]> => {
      onRefresh();
      return [{ kind: "adapter", name: "hackernews", status: "ok" }];
    };
    return createTestServerApp(
      makeServerRouteDeps({
        layout: testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" })),
        panelNameToId: new Map([["tech", "tech-panel"]]),
        panelIdToRefreshSourceNames: new Map([["tech-panel", ["hackernews"]]]),
        refreshSources,
      }),
    );
  }

  test("cross-site form post is rejected with 403 and does not refresh", async () => {
    let refreshed = 0;
    const app = makeApp(() => refreshed++);
    const res = await requestServerRoute(app, "/refresh/tech", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Forbidden");
    expect(refreshed).toBe(0);
  });

  test("same-origin browser post still refreshes and redirects", async () => {
    let refreshed = 0;
    const app = makeApp(() => refreshed++);
    const res = await requestServerRoute(app, "/refresh/tech", {
      method: "POST",
      headers: {
        "sec-fetch-site": "same-origin",
        origin: "http://localhost:3000",
        host: "localhost:3000",
      },
    });
    expect(res.status).toBe(303);
    expect(refreshed).toBe(1);
  });

  test("header-less client (curl) still refreshes", async () => {
    let refreshed = 0;
    const app = makeApp(() => refreshed++);
    const res = await requestServerRoute(app, "/refresh/tech", { method: "POST" });
    expect(res.status).toBe(303);
    expect(refreshed).toBe(1);
  });
});
