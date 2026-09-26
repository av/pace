import { describe, test, expect } from "bun:test";
import { saveItems } from "../db";
import { makeContentItem } from "../test/content-items";
import { installTempDbHooks } from "../test/temp-db";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import {
  createTestServerApp,
  expectSecurityHeaders,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";
import { BRIEF_MARKDOWN_CONTENT_TYPE } from "./api-brief";

installTempDbHooks({ prefix: "pace-api-brief-" });

function layout() {
  return flexCfg("row", [
    panelCfg("Tech", "hackernews", { id: "tech-panel" }),
    panelCfg("Blogs", "rss", { id: "blogs-panel" }),
    panelCfg("Links", "bookmarks", { id: "links-panel" }),
  ]);
}

function app(basePath = "") {
  return createTestServerApp(
    makeServerRouteDeps({
      layout: layout(),
      basePath,
      brief: {
        configLabel: "preset:test",
        nonFeedSources: new Set(["bookmarks"]),
        pipelineNames: new Set(),
      },
    }),
  );
}

function seed() {
  const recent = new Date(Date.now() - 2 * 3_600_000);
  saveItems("tech-panel", [
    makeContentItem({ id: "t1", title: "Tech story about models", url: "https://ex.com/t1", body: "120 points | by a | 30 comments", timestamp: recent }),
  ]);
  saveItems("blogs-panel", [
    makeContentItem({ id: "b1", title: "Blog post about evals", url: "https://ex.com/b1", body: "<p>Evals are hard.</p>", timestamp: recent }),
    makeContentItem({ id: "b0", title: "Ancient blog post", url: "https://ex.com/b0", timestamp: new Date(Date.now() - 30 * 86_400_000) }),
  ]);
  saveItems("links-panel", [makeContentItem({ id: "l1", title: "A bookmark", url: "https://ex.com/l1", timestamp: recent })]);
}

describe("GET /api/brief", () => {
  test("serves the pace.brief/v1 document as JSON", async () => {
    seed();
    const res = await requestServerRoute(app(), "/api/brief");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expectSecurityHeaders(res);
    const body = (await res.json()) as any;
    expect(body.schema).toBe("pace.brief/v1");
    expect(body.config).toBe("preset:test");
    expect(body.scope).toMatchObject({ panels: ["tech-panel", "blogs-panel"], skipped_panels: ["links-panel"], window: "72h", limit: 40, per_panel: 8 });
    expect(body.items.map((i: any) => i.id)).toEqual(["t1", "b1"]);
    expect(body.items[0].engagement).toEqual({ points: 120, comments: 30 });
    expect(body.items[1].summary).toBe("Evals are hard.");
  });

  test("honors panel (id or name, repeatable or comma list), limit, per_panel and since", async () => {
    seed();
    const a = app();
    const byName = (await (await requestServerRoute(a, "/api/brief?panel=Blogs&since=all")).json()) as any;
    expect(byName.items.map((i: any) => i.id)).toEqual(["b1", "b0"]);
    const repeated = (await (await requestServerRoute(a, "/api/brief?panel=blogs-panel&panel=Tech")).json()) as any;
    expect(repeated.scope.panels).toEqual(["tech-panel", "blogs-panel"]);
    const comma = (await (await requestServerRoute(a, "/api/brief?panel=Tech,Links")).json()) as any;
    expect(comma.items.map((i: any) => i.id)).toEqual(["t1", "l1"]);
    const limited = (await (await requestServerRoute(a, "/api/brief?limit=1")).json()) as any;
    expect(limited.items).toHaveLength(1);
    expect(limited.counts.cut_by_limits).toBe(1);
    const perPanel = (await (await requestServerRoute(a, "/api/brief?panel=Blogs&since=all&per_panel=1")).json()) as any;
    expect(perPanel.items.map((i: any) => i.id)).toEqual(["b1"]);
    const tight = (await (await requestServerRoute(a, "/api/brief?since=90m")).json()) as any;
    expect(tight.items).toHaveLength(0);
    expect(tight.scope.window).toBe("90m");
  });

  test.each([
    ["limit=0", "limit must be between 1 and 200"],
    ["limit=abc", "limit must be a positive integer"],
    ["per_panel=51", "per_panel must be between 1 and 50"],
    ["since=yesterday", "since must be a duration like 90m, 24h, 3d or 1w, an ISO date, or all"],
  ])("rejects %s with a 400", async (query, error) => {
    const res = await requestServerRoute(app(), `/api/brief?${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  test("unknown panel is a 404", async () => {
    const res = await requestServerRoute(app(), "/api/brief?panel=nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unknown panel: nope" });
  });

  test("serves under the base path and with neutral defaults when no config info is wired", async () => {
    seed();
    expect((await requestServerRoute(app("/pace"), "/pace/api/brief")).status).toBe(200);
    const bare = createTestServerApp(makeServerRouteDeps({ layout: layout() }));
    const body = (await (await requestServerRoute(bare, "/api/brief")).json()) as any;
    expect(body.config).toBe("config");
    expect(body.scope.skipped_panels).toEqual([]);
  });

  test("existing /api/panels responses are unchanged by the brief", async () => {
    seed();
    const body = (await (await requestServerRoute(app(), "/api/panels")).json()) as any;
    expect(Object.keys(body)).toEqual(["panels"]);
    expect(Object.keys(body.panels[0]).sort()).toEqual(["id", "item_count", "last_refreshed_at", "name", "sources"]);
  });
});

describe("GET /brief.md", () => {
  test("serves the same brief as Markdown", async () => {
    seed();
    const res = await requestServerRoute(app(), "/brief.md?since=24h");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(BRIEF_MARKDOWN_CONTENT_TYPE);
    expectSecurityHeaders(res);
    const md = await res.text();
    expect(md.startsWith("# Pace brief: preset:test\n")).toBe(true);
    expect(md).toContain("## Tech\n\n- [1] Tech story about models");
    expect(md).toContain("## Blogs\n\n- [2] Blog post about evals");
    expect(md).toContain("Skipped reference panels: Links.");
    expect(md).not.toContain("Ancient blog post");
  });

  test("errors are plain text with the same status codes", async () => {
    const bad = await requestServerRoute(app(), "/brief.md?limit=0");
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe("limit must be between 1 and 200\n");
    const unknown = await requestServerRoute(app(), "/brief.md?panel=nope");
    expect(unknown.status).toBe(404);
  });
});
