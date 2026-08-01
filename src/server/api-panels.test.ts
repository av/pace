import { describe, test, expect } from "bun:test";
import { initDb, saveItems } from "../db";
import {
  MAX_API_PANEL_ITEMS_LIMIT,
  parseApiPanelItemsLimit,
  serializeApiPanelItem,
} from "./api-panels";
import { makeContentItem as makeItem, makeContentItemRow } from "../test/content-items";
import { installTempDbHooks } from "../test/temp-db";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import {
  createTestServerApp,
  expectSecurityHeaders,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

installTempDbHooks({ prefix: "pace-api-panels-" });

function twoPanelLayout() {
  return flexCfg("row", [
    panelCfg("Tech", "hackernews", { id: "tech-panel" }),
    panelCfg("Blogs", "rss", { id: "blogs-panel" }),
  ]);
}

async function getJson(app: ReturnType<typeof createTestServerApp>, path: string) {
  const res = await requestServerRoute(app, path);
  return { res, body: (await res.json()) as any };
}

describe("parseApiPanelItemsLimit", () => {
  test("absent limit resolves to the panel default", () => {
    expect(parseApiPanelItemsLimit(undefined)).toEqual({ ok: true, limit: undefined });
  });

  test("accepts positive integers up to the cap", () => {
    expect(parseApiPanelItemsLimit("1")).toEqual({ ok: true, limit: 1 });
    expect(parseApiPanelItemsLimit(String(MAX_API_PANEL_ITEMS_LIMIT))).toEqual({
      ok: true,
      limit: MAX_API_PANEL_ITEMS_LIMIT,
    });
  });

  test.each(["abc", "-1", "1.5", "", "1e3"])("rejects non-integer %j", (raw) => {
    const result = parseApiPanelItemsLimit(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("limit must be a positive integer");
  });

  test.each(["0", String(MAX_API_PANEL_ITEMS_LIMIT + 1)])(
    "rejects out-of-range %j",
    (raw) => {
      const result = parseApiPanelItemsLimit(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          `limit must be between 1 and ${MAX_API_PANEL_ITEMS_LIMIT}`,
        );
      }
    },
  );
});

describe("serializeApiPanelItem", () => {
  test("projects public fields and decodes origins", () => {
    const row = makeContentItemRow({
      id: "r1",
      title: "Row",
      url: "https://ex.com/r1",
      source: "hackernews",
      summary: "A summary",
      score: 7.5,
      origins: JSON.stringify(["hackernews", "rss"]),
      applied_transforms: JSON.stringify(["dedupe"]),
      owner_source: "hackernews",
    });

    const item = serializeApiPanelItem(row);

    expect(item.origins).toEqual(["hackernews", "rss"]);
    expect(item.summary).toBe("A summary");
    expect(item.score).toBe(7.5);
    // Internal bookkeeping columns must not leak into the API payload.
    expect(item).not.toHaveProperty("panel_id");
    expect(item).not.toHaveProperty("applied_transforms");
    expect(item).not.toHaveProperty("owner_source");
  });

  test("degrades malformed origins to an empty array", () => {
    const item = serializeApiPanelItem(makeContentItemRow({ origins: "{not json" }));
    expect(item.origins).toEqual([]);
  });
});

describe("GET /api/panels", () => {
  test("lists every panel with counts, sources, and refresh time", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", source: "hackernews" }),
      makeItem({ id: "t2", source: "hackernews" }),
    ]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/panels");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expectSecurityHeaders(res);
    expect(body.panels).toHaveLength(2);

    const tech = body.panels.find((p: any) => p.id === "tech-panel");
    expect(tech).toMatchObject({
      id: "tech-panel",
      name: "Tech",
      sources: ["hackernews"],
      item_count: 2,
    });
    expect(typeof tech.last_refreshed_at).toBe("string");

    const blogs = body.panels.find((p: any) => p.id === "blogs-panel");
    expect(blogs).toMatchObject({ name: "Blogs", item_count: 0, last_refreshed_at: null });
  });

  test("serves under a configured base path", async () => {
    initDb();
    const app = createTestServerApp(
      makeServerRouteDeps({ layout: twoPanelLayout(), basePath: "/pace" }),
    );
    const { res, body } = await getJson(app, "/pace/api/panels");
    expect(res.status).toBe(200);
    expect(body.panels).toHaveLength(2);
  });
});

describe("GET /api/panels/:panel", () => {
  test("returns the panel's items by panel id", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({
        id: "t1",
        title: "HN Story",
        url: "https://news.ycombinator.com/item",
        source: "hackernews",
        timestamp: new Date("2026-08-01T10:00:00Z"),
      }),
    ]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/panels/tech-panel");

    expect(res.status).toBe(200);
    expect(body.id).toBe("tech-panel");
    expect(body.name).toBe("Tech");
    expect(typeof body.last_refreshed_at).toBe("string");
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "t1",
      title: "HN Story",
      url: "https://news.ycombinator.com/item",
      source: "hackernews",
      timestamp: "2026-08-01T10:00:00.000Z",
      summary: null,
      score: null,
      origins: ["hackernews"],
    });
    expect(typeof body.items[0].fetched_at).toBe("string");
  });

  test("resolves the panel display name like the refresh route", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", source: "hackernews" })]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/panels/Tech");

    expect(res.status).toBe(200);
    expect(body.id).toBe("tech-panel");
    expect(body.items).toHaveLength(1);
  });

  test("merges every panel's items for source: all", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", source: "hackernews" })]);
    saveItems("blogs-panel", [makeItem({ id: "b1", source: "rss" })]);

    const layout = flexCfg("row", [
      panelCfg("Tech", "hackernews", { id: "tech-panel" }),
      panelCfg("Blogs", "rss", { id: "blogs-panel" }),
      panelCfg("Firehose", "all", { id: "firehose" }),
    ]);
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const { res, body } = await getJson(app, "/api/panels/firehose");

    expect(res.status).toBe(200);
    const ids = body.items.map((item: any) => item.id).sort();
    expect(ids).toEqual(["b1", "t1"]);
  });

  test("honors the ?limit= override", async () => {
    initDb();
    saveItems(
      "tech-panel",
      [1, 2, 3].map((n) =>
        makeItem({
          id: `t${n}`,
          source: "hackernews",
          timestamp: new Date(`2026-08-01T0${n}:00:00Z`),
        }),
      ),
    );

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/panels/tech-panel?limit=2");

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(2);
    // Newest-first ordering, so the oldest item falls off.
    expect(body.items.map((item: any) => item.id)).toEqual(["t3", "t2"]);
  });

  test.each(["abc", "0", "-3", "9999"])(
    "rejects invalid ?limit=%s with a JSON 400",
    async (raw) => {
      initDb();
      const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
      const { res, body } = await getJson(app, `/api/panels/tech-panel?limit=${raw}`);
      expect(res.status).toBe(400);
      expect(typeof body.error).toBe("string");
      expect(body.error).toContain("limit");
    },
  );

  test("returns JSON 404 for unknown panels", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/panels/nope");
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Unknown panel: nope" });
  });
});
