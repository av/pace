import { describe, test, expect } from "bun:test";
import { XMLParser } from "fast-xml-parser";
import { initDb, saveItems } from "../db";
import {
  escapeXml,
  formatRssDate,
  renderRssItem,
  resolveRssFeedLinks,
  RSS_CONTENT_TYPE,
} from "./api-panels-rss";
import { makeContentItem as makeItem, makeContentItemRow } from "../test/content-items";
import { installTempDbHooks } from "../test/temp-db";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import {
  createTestServerApp,
  expectSecurityHeaders,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

installTempDbHooks({ prefix: "pace-api-panels-rss-" });

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

describe("escapeXml", () => {
  test("escapes all five XML special characters", () => {
    expect(escapeXml(`Tom & Jerry <b>"quoted" 'apos'</b>`)).toBe(
      "Tom &amp; Jerry &lt;b&gt;&quot;quoted&quot; &apos;apos&apos;&lt;/b&gt;",
    );
  });

  test("passes plain text through unchanged", () => {
    expect(escapeXml("plain text 123")).toBe("plain text 123");
  });
});

describe("formatRssDate", () => {
  test("formats ISO timestamps as RFC 822 GMT dates", () => {
    expect(formatRssDate("2026-08-01T10:00:00.000Z")).toBe(
      "Sat, 01 Aug 2026 10:00:00 GMT",
    );
  });

  test.each([null, "", "not-a-date"])("yields null for %j", (raw) => {
    expect(formatRssDate(raw)).toBeNull();
  });
});

describe("renderRssItem", () => {
  test("emits title, link, non-permalink guid, category, pubDate, description", () => {
    const xml = renderRssItem(
      makeContentItemRow({
        id: "r1",
        title: "Story",
        url: "https://ex.com/r1",
        source: "hackernews",
        summary: "A summary",
        timestamp: "2026-08-01T10:00:00.000Z",
      }),
    );
    expect(xml).toContain("<title>Story</title>");
    expect(xml).toContain("<link>https://ex.com/r1</link>");
    expect(xml).toContain('<guid isPermaLink="false">r1</guid>');
    expect(xml).toContain("<category>hackernews</category>");
    expect(xml).toContain("<pubDate>Sat, 01 Aug 2026 10:00:00 GMT</pubDate>");
    expect(xml).toContain("<description>A summary</description>");
  });

  test("falls back to body when there is no summary, omits when neither", () => {
    const withBody = renderRssItem(
      makeContentItemRow({ summary: null, body: "Body text" }),
    );
    expect(withBody).toContain("<description>Body text</description>");

    const bare = renderRssItem(makeContentItemRow({ summary: null, body: null }));
    expect(bare).not.toContain("<description>");
  });

  test("omits pubDate for unparseable timestamps instead of emitting Invalid Date", () => {
    const xml = renderRssItem(makeContentItemRow({ timestamp: "garbage" }));
    expect(xml).not.toContain("<pubDate>");
    expect(xml).not.toContain("Invalid Date");
  });
});

describe("resolveRssFeedLinks", () => {
  test("derives site and self links from the request URL", () => {
    expect(
      resolveRssFeedLinks("http://localhost:7453/api/panels/tech.rss?limit=5", ""),
    ).toEqual({
      siteUrl: "http://localhost:7453/",
      feedUrl: "http://localhost:7453/api/panels/tech.rss",
    });
  });

  test("points the site link at the configured base path", () => {
    expect(
      resolveRssFeedLinks("https://ex.com/pace/api/panels/tech.rss", "/pace"),
    ).toEqual({
      siteUrl: "https://ex.com/pace",
      feedUrl: "https://ex.com/pace/api/panels/tech.rss",
    });
  });
});

describe("GET /api/panels/:panel.rss", () => {
  test("serves a well-formed RSS 2.0 feed for a panel", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({
        id: "t1",
        title: "HN Story",
        url: "https://news.ycombinator.com/item",
        source: "hackernews",
        body: "What happened",
        timestamp: new Date("2026-08-01T10:00:00Z"),
      }),
    ]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/panels/tech-panel.rss");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(RSS_CONTENT_TYPE);
    expectSecurityHeaders(res);
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);

    const doc = strictXmlParser.parse(text);
    expect(doc.rss["@_version"]).toBe("2.0");
    const channel = doc.rss.channel;
    expect(channel.title).toBe("Tech");
    expect(channel.link).toBe("http://localhost/");
    expect(channel.generator).toBe("pace");
    expect(typeof channel.lastBuildDate).toBe("string");
    const selfLink = channel["atom:link"];
    expect(selfLink["@_rel"]).toBe("self");
    expect(selfLink["@_href"]).toBe("http://localhost/api/panels/tech-panel.rss");

    const items = asArray<any>(channel.item);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "HN Story",
      link: "https://news.ycombinator.com/item",
      category: "hackernews",
      pubDate: "Sat, 01 Aug 2026 10:00:00 GMT",
      description: "What happened",
    });
    expect(items[0].guid["#text"]).toBe("t1");
    expect(items[0].guid["@_isPermaLink"]).toBe("false");
  });

  test("escapes XML special characters so hostile titles stay well-formed", async () => {
    initDb();
    saveItems("tech-panel", [
      makeItem({
        id: "t1",
        title: `<script>alert("x")</script> & more`,
        url: "https://ex.com/?a=1&b=2",
        source: "hackernews",
      }),
    ]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/panels/tech-panel.rss");

    expect(res.status).toBe(200);
    expect(text).not.toContain("<script>");
    const item = strictXmlParser.parse(text).rss.channel.item;
    expect(item.title).toBe(`<script>alert("x")</script> & more`);
    expect(item.link).toBe("https://ex.com/?a=1&b=2");
  });

  test("resolves the panel display name like the JSON endpoint", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", source: "hackernews" })]);

    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/panels/Tech.rss");

    expect(res.status).toBe(200);
    const item = strictXmlParser.parse(text).rss.channel.item;
    expect(item.guid["#text"]).toBe("t1");
  });

  test("honors the ?limit= override, newest first", async () => {
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
    const { res, text } = await getRss(app, "/api/panels/tech-panel.rss?limit=2");

    expect(res.status).toBe(200);
    const items = asArray<any>(strictXmlParser.parse(text).rss.channel.item);
    expect(items.map((item) => item.guid["#text"])).toEqual(["t3", "t2"]);
  });

  test("rejects invalid ?limit= with a JSON 400", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const res = await requestServerRoute(app, "/api/panels/tech-panel.rss?limit=abc");
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("limit");
  });

  test.each(["nope.rss", ".rss"])(
    "returns JSON 404 for unknown panel %j",
    async (param) => {
      initDb();
      const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
      const res = await requestServerRoute(app, `/api/panels/${param}`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body).toEqual({
        error: `Unknown panel: ${param.slice(0, -".rss".length)}`,
      });
    },
  );

  test("serves an empty panel as a valid feed with no items", async () => {
    initDb();
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const { res, text } = await getRss(app, "/api/panels/blogs-panel.rss");

    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(channel.title).toBe("Blogs");
    expect(asArray(channel.item)).toHaveLength(0);
    expect(channel.lastBuildDate).toBeUndefined();
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
    const { res, text } = await getRss(app, "/api/panels/firehose.rss");

    expect(res.status).toBe(200);
    const items = asArray<any>(strictXmlParser.parse(text).rss.channel.item);
    expect(items.map((item) => item.guid["#text"]).sort()).toEqual(["b1", "t1"]);
  });

  test("serves under a configured base path with base-path links", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", source: "hackernews" })]);
    const app = createTestServerApp(
      makeServerRouteDeps({ layout: twoPanelLayout(), basePath: "/pace" }),
    );
    const { res, text } = await getRss(app, "/pace/api/panels/tech-panel.rss");

    expect(res.status).toBe(200);
    const channel = strictXmlParser.parse(text).rss.channel;
    expect(channel.link).toBe("http://localhost/pace");
    expect(channel["atom:link"]["@_href"]).toBe(
      "http://localhost/pace/api/panels/tech-panel.rss",
    );
  });

  test("the plain JSON endpoint still serves panels without the suffix", async () => {
    initDb();
    saveItems("tech-panel", [makeItem({ id: "t1", source: "hackernews" })]);
    const app = createTestServerApp(makeServerRouteDeps({ layout: twoPanelLayout() }));
    const res = await requestServerRoute(app, "/api/panels/tech-panel");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
