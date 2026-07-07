import { describe, test, expect } from "bun:test";
import {
  collectRefreshSkips,
  formatRefreshSkippedNotice,
  type RefreshResult,
} from "../refresh-result";
import { resolveSkippedNotice } from "./routes";
import { singlePanelLayout, testAppLayout } from "../test/app-config";
import { installTempDbHooks } from "../test/temp-db";
import {
  createTestServerApp,
  makeServerRouteDeps,
  requestRefreshPanel,
  requestServerRoute,
} from "../test/server-harness";

describe("collectRefreshSkips", () => {
  test("keeps only skipped results", () => {
    const results: RefreshResult[] = [
      { kind: "adapter", name: "a", status: "ok" },
      { kind: "adapter", name: "b", status: "skipped" },
      { kind: "pipeline", name: "c", status: "failed", error: "x" },
      { kind: "pipeline", name: "d", status: "skipped" },
    ];
    expect(collectRefreshSkips(results).map((r) => r.name)).toEqual(["b", "d"]);
  });

  test("empty input yields empty output", () => {
    expect(collectRefreshSkips([])).toEqual([]);
  });
});

describe("formatRefreshSkippedNotice", () => {
  test("joins names with commas", () => {
    expect(formatRefreshSkippedNotice(["hn", "reddit"])).toBe(
      "Refresh already in progress for hn, reddit — showing existing data.",
    );
  });
});

describe("resolveSkippedNotice", () => {
  const sourceMap = new Map([
    ["panel-1", ["hackernews", "reddit"]],
    ["panel-2", ["arxiv"]],
  ]);

  test("returns undefined for missing param", () => {
    expect(resolveSkippedNotice(undefined, sourceMap)).toBeUndefined();
    expect(resolveSkippedNotice("", sourceMap)).toBeUndefined();
  });

  test("builds notice for known names", () => {
    expect(resolveSkippedNotice("hackernews,arxiv", sourceMap)).toBe(
      formatRefreshSkippedNotice(["hackernews", "arxiv"]),
    );
  });

  test("drops unknown (user-controllable) names", () => {
    expect(
      resolveSkippedNotice("hackernews,<script>alert(1)</script>", sourceMap),
    ).toBe(formatRefreshSkippedNotice(["hackernews"]));
  });

  test("returns undefined when no names are known", () => {
    expect(resolveSkippedNotice("bogus,also-bogus", sourceMap)).toBeUndefined();
  });
});

describe("skipped refresh end-to-end", () => {
  installTempDbHooks({ prefix: "pace-refresh-skip-" });

  function makeDeps(refreshSources: () => Promise<RefreshResult[]>) {
    return makeServerRouteDeps({
      layout: testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" })),
      panelNameToId: new Map([["tech", "tech-panel"]]),
      panelIdToRefreshSourceNames: new Map([["tech-panel", ["hackernews", "reddit"]]]),
      refreshSources,
    });
  }

  test("redirects with ?skipped= listing only skipped sources", async () => {
    const deps = makeDeps(async () => [
      { kind: "adapter", name: "hackernews", status: "ok" },
      { kind: "adapter", name: "reddit", status: "skipped" },
    ]);
    const res = await requestRefreshPanel(createTestServerApp(deps), "tech");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?skipped=reddit");
  });

  test("failure still wins over skips (502, no redirect)", async () => {
    const deps = makeDeps(async () => [
      { kind: "adapter", name: "hackernews", status: "failed", error: "boom" },
      { kind: "adapter", name: "reddit", status: "skipped" },
    ]);
    const res = await requestRefreshPanel(createTestServerApp(deps), "tech");
    expect(res.status).toBe(502);
  });

  test("all-ok refresh redirects without ?skipped=", async () => {
    const deps = makeDeps(async () => [
      { kind: "adapter", name: "hackernews", status: "ok" },
    ]);
    const res = await requestRefreshPanel(createTestServerApp(deps), "tech");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  test("dashboard renders notice for known skipped source", async () => {
    const deps = makeDeps(async () => []);
    const app = createTestServerApp(deps);
    const res = await requestServerRoute(app, "/?skipped=reddit");
    const html = await res.text();
    expect(html).toContain('class="refresh-notice"');
    expect(html).toContain("Refresh already in progress for reddit");
  });

  test("dashboard ignores unknown skipped names (no notice, no injection)", async () => {
    const deps = makeDeps(async () => []);
    const app = createTestServerApp(deps);
    const res = await requestServerRoute(
      app,
      "/?skipped=" + encodeURIComponent("<img src=x onerror=alert(1)>"),
    );
    const html = await res.text();
    expect(html).not.toContain("refresh-notice");
    expect(html).not.toContain("onerror");
  });

  test("skipped redirect respects basePath", async () => {
    const deps = makeServerRouteDeps({
      layout: testAppLayout(singlePanelLayout("Tech", "hackernews", { id: "tech-panel" })),
      panelNameToId: new Map([["tech", "tech-panel"]]),
      panelIdToRefreshSourceNames: new Map([["tech-panel", ["hackernews"]]]),
      refreshSources: async () => [
        { kind: "adapter", name: "hackernews", status: "skipped" },
      ],
      basePath: "/pace",
    });
    const res = await requestRefreshPanel(createTestServerApp(deps), "tech");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/pace/?skipped=hackernews");
  });
});
