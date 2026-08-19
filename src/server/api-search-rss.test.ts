import { describe, test, expect } from "bun:test";
import { XMLParser } from "fast-xml-parser";
import { initDb, itemSeenKey, saveItems, setItemSeen, setItemStarred } from "../db";
import { renderSearchRss, resolveSearchRssFeedLinks } from "./api-search-rss";
import { RSS_CONTENT_TYPE } from "./api-panels-rss";
import { makeContentItem as makeItem, makeContentItemRow } from "../test/content-items";
import { installTempDbHooks } from "../test/temp-db";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import {
  createTestServerApp,
  expectSecurityHeaders,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

installTempDbHooks({ prefix: "pace-api-search-rss-" });

function twoPanelLayout() {
  return flexCfg("row", [
    panelCfg("Tech", "hackernews", { id: "tech-panel" }),
    panelCfg("Blogs", "rss", { id: "blogs-panel" }),
  ]);
}

const strictXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

async function getRss(app: ReturnType<typeof createTestServerApp>, path: string) {
  const res = await requestServerRoute(app, path);
  const text = await res.text();
  return { res, text };
}

/** Normalize fast-xml-parser's single-item collapse to an array. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const links = {
  siteUrl: "http://localhost:7453/",
  feedUrl: "http://localhost:7453/api/search.rss?q=rust",
};

describe("renderSearchRss", () => {
  test("renders a well-formed RSS 2.0 document titled after the query", () => {
    const xml = renderSearchRss(
      "rust wasm",
      [makeContentItemRow({ id: "r1", title: "Rust & WASM", panel_id: "tech-panel" })],
      links,
    );
    const doc = strictXmlParser.parse(xml);
    expect(doc.rss["@_version"]).toBe("2.0");
    const channel = doc.rss.channel;
    expect(channel.title).toBe("pace search: rust wasm");
    expect(channel.link).toBe(links.siteUrl);
    expect(channel.generator).toBe("pace");
    expect(channel["atom:link"]["@_href"]).toBe(links.feedUrl);
    expect(channel["atom:link"]["@_rel"]).toBe("self");
    expect(asArray(channel.item)).toHaveLength(1);
  });

  test("uses the newest hit's timestamp as lastBuildDate", () => {
    const xml = renderSearchRss(
      "rust",
      [
        makeContentItemRow({ id: "r1", timestamp: "2026-08-02T10:00:00.000Z" }),
        makeContentItemRow({ id: "r2", timestamp: "2026-08-01T10:00:00.000Z" }),
      ],
      links,
    );
    const channel = strictXmlParser.parse(xml).rss.channel;
    expect(channel.lastBuildDate).toBe("Sun, 02 Aug 2026 10:00:00 GMT");
  });

  test("empty result set omits lastBuildDate and has no items", () => {
    const xml = renderSearchRss("nomatch", [], links);
    const channel = strictXmlParser.parse(xml).rss.channel;
    expect(channel.lastBuildDate).toBeUndefined();
    expect(asArray(channel.item)).toHaveLength(0);
  });
});

describe("resolveSearchRssFeedLinks", () => {
  test("keeps the query string in the self link — it is the feed's identity", () => {
    const resolved = resolveSearchRssFeedLinks(
      "http://localhost:7453/api/search.rss?q=rust+wasm&limit=10",
      "",
    );
    expect(resolved.siteUrl).toBe("http://localhost:7453/");
    expect(resolved.feedUrl).toBe("http://localhost:7453/api/search.rss?q=rust+wasm&limit=10");
  });

  test("uses the base path for the site link", () => {
    const resolved = resolveSearchRssFeedLinks(
      "http://localhost:7453/pace/api/search.rss?q=rust",
      "/pace",
    );
    expect(resolved.siteUrl).toBe("http://localhost:7453/pace");
    expect(resolved.feedUrl).toBe("http://localhost:7453/pace/api/search.rss?q=rust");
  });
});

describe("GET /api/search.rss", () => {
  test("serves matching items across panels as RSS, newest first", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Rust in tech", timestamp: new Date("2026-08-02T10:00:00Z") }),
      makeItem({ id: "t2", title: "Unrelated" }),
    ]);
    saveItems("blogs-panel", [
      makeItem({ id: "b1", title: "Rust on blogs", timestamp: new Date("2026-08-01T10:00:00Z") }),
    ]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/search.rss?q=rust");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(RSS_CONTENT_TYPE);
    expectSecurityHeaders(res);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(channel.title).toBe("pace search: rust");
    expect(asArray(channel.item).map((item: any) => item.title)).toEqual([
      "Rust in tech",
      "Rust on blogs",
    ]);
  });

  test("starred:yes yields a subscribable starred-search feed titled with the operator", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Rust starred", url: "https://ex.com/s" }),
      makeItem({ id: "t2", title: "Rust plain", url: "https://ex.com/p" }),
    ]);
    setItemStarred(itemSeenKey({ id: "t1", url: "https://ex.com/s" }), true);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/search.rss?q=rust%20starred:yes");
    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(channel.title).toBe("pace search: rust starred:yes");
    expect(asArray(channel.item).map((item: any) => item.title)).toEqual(["Rust starred"]);

    const bad = await requestServerRoute(app, "/api/search.rss?q=starred:maybe");
    expect(bad.status).toBe(400);
  });

  test("seen:no yields an unread-items feed titled with the operator", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({ id: "t1", title: "Rust read", url: "https://ex.com/r" }),
      makeItem({ id: "t2", title: "Rust fresh", url: "https://ex.com/f" }),
    ]);
    setItemSeen(itemSeenKey({ id: "t1", url: "https://ex.com/r" }), true);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/search.rss?q=rust%20seen:no");
    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(channel.title).toBe("pace search: rust seen:no");
    expect(asArray(channel.item).map((item: any) => item.title)).toEqual(["Rust fresh"]);

    const bad = await requestServerRoute(app, "/api/search.rss?q=seen:maybe");
    expect(bad.status).toBe(400);
  });

  test("scopes to a panel and applies the limit like the JSON endpoint", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", title: "rust tech" })]);
    saveItems("blogs-panel", [makeItem({ id: "b1", title: "rust blog" })]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/search.rss?q=rust&panel=Blogs&limit=5");
    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(asArray(channel.item).map((item: any) => item.title)).toEqual(["rust blog"]);
  });

  test("missing q is a JSON 400", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const res = await requestServerRoute(app, "/api/search.rss");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe(
      "q is required and must contain at least one search term",
    );
  });

  test("invalid limit is a JSON 400 and unknown panel a JSON 404", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));

    const badLimit = await requestServerRoute(app, "/api/search.rss?q=rust&limit=0");
    expect(badLimit.status).toBe(400);

    const badPanel = await requestServerRoute(app, "/api/search.rss?q=rust&panel=nope");
    expect(badPanel.status).toBe(404);
    expect(((await badPanel.json()) as any).error).toBe("Unknown panel: nope");
  });

  test("empty result set is still a valid 200 feed", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/search.rss?q=nomatch");
    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(channel.title).toBe("pace search: nomatch");
    expect(asArray(channel.item)).toHaveLength(0);
  });

  test("serves under a configured base path with a self link that keeps the query", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", title: "rust" })]);
    const app = createTestServerApp(
      makeServerRouteDeps({ layout: twoPanelLayout(), basePath: "/pace" }),
    );
    const { res, text } = await getRss(app, "/pace/api/search.rss?q=rust");
    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(channel.link).toContain("/pace");
    expect(channel["atom:link"]["@_href"]).toContain("/pace/api/search.rss?q=rust");
  });
});
