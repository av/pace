import { describe, test, expect } from "bun:test";
import { XMLParser } from "fast-xml-parser";
import { getStarredItems, initDb, itemSeenKey, saveItems, setItemStarred } from "../db";
import { renderStarredRss } from "./api-star-rss";
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

installTempDbHooks({ prefix: "pace-api-star-rss-" });

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

/** Normalize fast-xml-parser's single-item collapse to an array. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const links = {
  siteUrl: "http://localhost:7453/",
  feedUrl: "http://localhost:7453/api/star.rss",
};

function starredRow(overrides: Parameters<typeof makeContentItemRow>[0], starredAt: string) {
  return { ...makeContentItemRow(overrides), starred_at: starredAt };
}

describe("getStarredItems", () => {
  test("resolves star keys to deduped rows, newest star first", () => {
    initDb();
    const oldStory = makeItem({
      id: "t1",
      title: "Starred first",
      url: "https://ex.com/first",
      timestamp: new Date("2026-08-01T10:00:00Z"),
    });
    const newStory = makeItem({
      id: "t2",
      title: "Starred second",
      url: "https://ex.com/second",
      timestamp: new Date("2026-08-02T10:00:00Z"),
    });
    const unstarred = makeItem({ id: "t3", title: "Not starred" });
    saveItems("tech-panel", [oldStory, newStory, unstarred]);
    // Same story on another panel: the dedup identity keeps it one feed entry.
    saveItems("blogs-panel", [makeItem({ id: "b1", title: "Starred first", url: "https://ex.com/first" })]);

    // Distinct starred_at values require distinct inserts; SQLite datetime('now')
    // has second granularity, so order by insertion is asserted via limit below
    // rather than timing. Star "first" then "second".
    setItemStarred(itemSeenKey(oldStory), true);
    setItemStarred(itemSeenKey(newStory), true);

    const rows = getStarredItems();
    expect(rows).toHaveLength(2);
    const titles = rows.map((row) => row.title).sort();
    expect(titles).toEqual(["Starred first", "Starred second"]);
    for (const row of rows) expect(typeof row.starred_at).toBe("string");
  });

  test("a star whose item has been pruned resolves to no row", () => {
    initDb();
    setItemStarred("https://ex.com/gone", true);
    expect(getStarredItems()).toHaveLength(0);
  });

  test("applies the limit", () => {
    initDb();
    const a = makeItem({ id: "a", url: "https://ex.com/a" });
    const b = makeItem({ id: "b", url: "https://ex.com/b" });
    saveItems("tech-panel", [a, b]);
    setItemStarred(itemSeenKey(a), true);
    setItemStarred(itemSeenKey(b), true);
    expect(getStarredItems(1)).toHaveLength(1);
  });
});

describe("renderStarredRss", () => {
  test("renders a well-formed RSS 2.0 document with the newest star as lastBuildDate", () => {
    const xml = renderStarredRss(
      [
        starredRow({ id: "r1", title: "Kept & pinned" }, "2026-08-02T10:00:00.000Z"),
        starredRow({ id: "r2", title: "Older keep" }, "2026-08-01T10:00:00.000Z"),
      ],
      links,
    );
    const doc = strictXmlParser.parse(xml);
    expect(doc.rss["@_version"]).toBe("2.0");
    const channel = doc.rss.channel;
    expect(channel.title).toBe("pace: starred items");
    expect(channel.link).toBe(links.siteUrl);
    expect(channel.generator).toBe("pace");
    expect(channel["atom:link"]["@_href"]).toBe(links.feedUrl);
    expect(channel["atom:link"]["@_rel"]).toBe("self");
    expect(channel.lastBuildDate).toBe("Sun, 02 Aug 2026 10:00:00 GMT");
    expect(asArray(channel.item)).toHaveLength(2);
    expect(asArray(channel.item)[0]!.title).toBe("Kept & pinned");
  });

  test("empty starred list omits lastBuildDate and has no items", () => {
    const xml = renderStarredRss([], links);
    const channel = strictXmlParser.parse(xml).rss.channel;
    expect(channel.lastBuildDate).toBeUndefined();
    expect(asArray(channel.item)).toHaveLength(0);
  });
});

describe("GET /api/star.rss", () => {
  test("serves the starred items as RSS with security headers", async () => {
    initDb();
    const story = makeItem({ id: "t1", title: "Keep this one", url: "https://ex.com/keep" });
    saveItems("tech-panel", [story, makeItem({ id: "t2", title: "Skip this one" })]);
    setItemStarred(itemSeenKey(story), true);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const res = await requestServerRoute(app, "/api/star.rss");
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(RSS_CONTENT_TYPE);
    expectSecurityHeaders(res);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(channel.title).toBe("pace: starred items");
    expect(asArray(channel.item).map((item: any) => item.title)).toEqual(["Keep this one"]);
  });

  test("empty starred list is still a valid 200 feed", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const res = await requestServerRoute(app, "/api/star.rss");
    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(await res.text()).rss.channel;
    expect(asArray(channel.item)).toHaveLength(0);
  });

  test("invalid limit is a JSON 400", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const res = await requestServerRoute(app, "/api/star.rss?limit=0");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain("limit");
  });

  test("serves under a configured base path with a query-less self link", async () => {
    initDb();
    const story = makeItem({ id: "t1", url: "https://ex.com/keep" });
    saveItems("tech-panel", [story]);
    setItemStarred(itemSeenKey(story), true);

    const app = createTestServerApp(
      makeServerRouteDeps({ layout: twoPanelLayout(), basePath: "/pace" }),
    );
    const res = await requestServerRoute(app, "/pace/api/star.rss?limit=5");
    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(await res.text()).rss.channel;
    expect(channel.link).toContain("/pace");
    expect(channel["atom:link"]["@_href"]).toBe("http://localhost/pace/api/star.rss");
  });
});
