import { describe, test, expect } from "bun:test";
import { escapeLikeTerm, initDb, replacePanelItems, saveItems, searchItems } from "../db";
import { DEFAULT_API_SEARCH_LIMIT, parseSearchTerms, serializeApiSearchItem } from "./api-search";
import { makeContentItem as makeItem, makeContentItemRow } from "../test/content-items";
import { installTempDbHooks } from "../test/temp-db";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import {
  createTestServerApp,
  expectSecurityHeaders,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

installTempDbHooks({ prefix: "pace-api-search-" });

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

describe("parseSearchTerms", () => {
  test("splits on whitespace and drops empties", () => {
    expect(parseSearchTerms("rust wasm")).toEqual(["rust", "wasm"]);
    expect(parseSearchTerms("  rust\t wasm ")).toEqual(["rust", "wasm"]);
  });

  test("absent or blank query yields no terms", () => {
    expect(parseSearchTerms(undefined)).toEqual([]);
    expect(parseSearchTerms("")).toEqual([]);
    expect(parseSearchTerms("   ")).toEqual([]);
  });
});

describe("escapeLikeTerm", () => {
  test("escapes LIKE wildcards and backslashes", () => {
    expect(escapeLikeTerm("100%")).toBe("100\\%");
    expect(escapeLikeTerm("snake_case")).toBe("snake\\_case");
    expect(escapeLikeTerm("a\\b")).toBe("a\\\\b");
    expect(escapeLikeTerm("plain")).toBe("plain");
  });
});

describe("searchItems", () => {
  test("matches terms case-insensitively across title, url, source, summary, and body", () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Rust in the kernel" }),
      makeItem({ id: "t2", title: "Other", url: "https://ex.com/rust-post" }),
      makeItem({ id: "t3", title: "Other", source: "rustweek" }),
      makeItem({ id: "t4", title: "Other", body: "all about RUST here" }),
      makeItem({ id: "t5", title: "Unrelated" }),
    ]);
    replacePanelItems("blogs-panel", [
      makeContentItemRow({
        id: "b1",
        panel_id: "blogs-panel",
        title: "Other",
        url: "https://ex.com/b1",
        summary: "A Rust retrospective",
        body: null,
      }),
    ]);

    const hits = searchItems(["rust"], { limit: 50 });
    expect(hits.map((row) => row.id).sort()).toEqual(["b1", "t1", "t2", "t3", "t4"]);
  });

  test("requires ALL terms to match (AND semantics)", () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Rust and WebAssembly" }),
      makeItem({ id: "t2", title: "Rust only" }),
      makeItem({ id: "t3", title: "WebAssembly only" }),
    ]);
    const hits = searchItems(["rust", "webassembly"], { limit: 50 });
    expect(hits.map((row) => row.id)).toEqual(["t1"]);
  });

  test("terms may match across different fields of the same item", () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Kernel news", body: "written in rust" }),
    ]);
    expect(searchItems(["rust", "kernel"], { limit: 50 })).toHaveLength(1);
  });

  test("treats LIKE wildcards in terms literally", () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Progress: 100% done" }),
      makeItem({ id: "t2", title: "Progress: 100x done" }),
    ]);
    expect(searchItems(["100%"], { limit: 50 }).map((row) => row.id)).toEqual(["t1"]);
  });

  test("scopes to one panel when panelId is given", () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", title: "Rust tech" })]);
    saveItems("blogs-panel", [makeItem({ id: "b1", title: "Rust blog" })]);

    const hits = searchItems(["rust"], { panelId: "blogs-panel", limit: 50 });
    expect(hits.map((row) => row.id)).toEqual(["b1"]);
  });

  test("searches deduped winners: a url shared across panels yields one hit", () => {
    initDb();
    const url = "https://ex.com/shared-rust-story";
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Rust story", url, timestamp: new Date("2026-08-01T10:00:00Z") }),
    ]);
    saveItems("blogs-panel", [
      makeItem({ id: "b1", title: "Rust story", url, timestamp: new Date("2026-08-02T10:00:00Z") }),
    ]);
    expect(searchItems(["rust"], { limit: 50 })).toHaveLength(1);
  });

  test("orders newest first and applies the limit", () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "rust a", timestamp: new Date("2026-08-01T10:00:00Z") }),
      makeItem({ id: "t2", title: "rust b", timestamp: new Date("2026-08-03T10:00:00Z") }),
      makeItem({ id: "t3", title: "rust c", timestamp: new Date("2026-08-02T10:00:00Z") }),
    ]);
    const hits = searchItems(["rust"], { limit: 2 });
    expect(hits.map((row) => row.id)).toEqual(["t2", "t3"]);
  });
});

describe("serializeApiSearchItem", () => {
  test("extends the panel item shape with the owning panel id", () => {
    const item = serializeApiSearchItem(
      makeContentItemRow({ id: "r1", panel_id: "tech-panel" }),
    );
    expect(item.panel).toBe("tech-panel");
    expect(item).not.toHaveProperty("panel_id");
    expect(item).not.toHaveProperty("applied_transforms");
    expect(item).not.toHaveProperty("owner_source");
  });
});

describe("GET /api/search", () => {
  test("returns matching items across panels with their panel ids", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Rust in tech", timestamp: new Date("2026-08-02T10:00:00Z") }),
      makeItem({ id: "t2", title: "Unrelated" }),
    ]);
    saveItems("blogs-panel", [
      makeItem({ id: "b1", title: "Rust on blogs", timestamp: new Date("2026-08-01T10:00:00Z") }),
    ]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/search?q=rust");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expectSecurityHeaders(res);
    expect(body.query).toBe("rust");
    expect(body.count).toBe(2);
    expect(body.items.map((item: any) => [item.id, item.panel])).toEqual([
      ["t1", "tech-panel"],
      ["b1", "blogs-panel"],
    ]);
  });

  test("multi-term query ANDs terms and normalizes whitespace in the echoed query", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Rust and WebAssembly" }),
      makeItem({ id: "t2", title: "Rust only" }),
    ]);
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/search?q=rust%20%20webassembly");
    expect(res.status).toBe(200);
    expect(body.query).toBe("rust webassembly");
    expect(body.items.map((item: any) => item.id)).toEqual(["t1"]);
  });

  test("scopes to a panel by id or display name", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", title: "rust tech" })]);
    saveItems("blogs-panel", [makeItem({ id: "b1", title: "rust blog" })]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const byId = await getJson(app, "/api/search?q=rust&panel=blogs-panel");
    expect(byId.body.items.map((item: any) => item.id)).toEqual(["b1"]);

    const byName = await getJson(app, "/api/search?q=rust&panel=Blogs");
    expect(byName.body.items.map((item: any) => item.id)).toEqual(["b1"]);
  });

  test("empty result set is a 200 with count 0", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/search?q=nomatch");
    expect(res.status).toBe(200);
    expect(body).toEqual({ query: "nomatch", count: 0, items: [] });
  });

  test("missing or blank q is a 400", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    for (const path of ["/api/search", "/api/search?q=", "/api/search?q=%20%20"]) {
      const { res, body } = await getJson(app, path);
      expect(res.status).toBe(400);
      expect(body.error).toBe("q is required and must contain at least one search term");
    }
  });

  test("invalid limit is a 400, valid limit caps results", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "rust a", timestamp: new Date("2026-08-02T10:00:00Z") }),
      makeItem({ id: "t2", title: "rust b", timestamp: new Date("2026-08-01T10:00:00Z") }),
    ]);
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));

    const bad = await getJson(app, "/api/search?q=rust&limit=abc");
    expect(bad.res.status).toBe(400);
    expect(bad.body.error).toBe("limit must be a positive integer");

    const capped = await getJson(app, "/api/search?q=rust&limit=1");
    expect(capped.res.status).toBe(200);
    expect(capped.body.items.map((item: any) => item.id)).toEqual(["t1"]);
  });

  test("unknown panel is a JSON 404 like the panel API", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, body } = await getJson(app, "/api/search?q=rust&panel=nope");
    expect(res.status).toBe(404);
    expect(body.error).toBe("Unknown panel: nope");
  });

  test("serves under a configured base path", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", title: "rust" })]);
    const app = createTestServerApp(
      makeServerRouteDeps({ layout: twoPanelLayout(), basePath: "/pace" }),
    );
    const { res, body } = await getJson(app, "/pace/api/search?q=rust");
    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
  });

  test("default limit constant matches the documented default", () => {
    expect(DEFAULT_API_SEARCH_LIMIT).toBe(50);
  });
});
