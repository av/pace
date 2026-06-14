/**
 * Adapter regression tests: verify existing adapters (RSS, HN, Reddit) still
 * work correctly after the bookmarks and counter additions, and verify the
 * adapter registry is consistent.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import rssAdapter from "./adapters/rss";
import hackernewsAdapter from "./adapters/hackernews";
import redditAdapter from "./adapters/reddit";
import { useFetchMockSuite } from "./test/adapter-mocks";
import { rssCfg, hnCfg, redditCfg } from "./test/adapter-cfg";
import { makeXmlResponse, makeJsonResponse } from "./test/fetch-responses";
import { rssDefaultFetchImpl } from "./test/rss-fixtures";
import { makeHNItem } from "./test/hackernews-fixtures";
import { makePost, makeListingResponse } from "./test/reddit-fixtures";
import { installTempDbHooks } from "./test/temp-db";
import { saveItems, getItemsByPanel, initDb } from "./db";

// ---------------------------------------------------------------------------
// RSS adapter still works (fetch mock, parse, DB round-trip)
// ---------------------------------------------------------------------------

describe("RSS adapter regression", () => {
  const mocks = useFetchMockSuite();

  beforeEach(() => {
    mocks.fetchMock.mockImplementation(rssDefaultFetchImpl);
  });

  test("RSS fetch returns items with expected fields", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/rss"] }));
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.title).toBe("string");
      expect(typeof item.url).toBe("string");
      expect(typeof item.source).toBe("string");
      expect(item.timestamp).toBeInstanceOf(Date);
    }
    expect(items[0].source).toBe("Example RSS Feed");
  });

});

describe("RSS DB round-trip regression", () => {
  const mocks = useFetchMockSuite();
  installTempDbHooks({ prefix: "pace-rss-reg-" });

  beforeEach(() => {
    mocks.fetchMock.mockImplementation(rssDefaultFetchImpl);
  });

  test("RSS items survive save+load through DB", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/rss"] }));
    expect(items.length).toBeGreaterThan(0);

    saveItems("rss-panel", items);
    const rows = getItemsByPanel("rss-panel", 50);
    expect(rows.length).toBe(items.length);

    for (const row of rows) {
      expect(row.panel_id).toBe("rss-panel");
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.url.length).toBeGreaterThan(0);
      expect(row.source).toBe("Example RSS Feed");
    }
  });
});

// ---------------------------------------------------------------------------
// Angle 2c: HN adapter still works
// ---------------------------------------------------------------------------

describe("HN adapter regression", () => {
  const mocks = useFetchMockSuite();

  test("HN fetch returns items with expected fields", async () => {
    const ids = [10, 20, 30];
    const hnItems = ids.map((id) => makeHNItem(id, { score: 50 + id }));
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("topstories.json")) return makeJsonResponse(ids);
      const match = String(url).match(/item\/(\d+)\.json/);
      if (match) {
        const id = parseInt(match[1], 10);
        const item = hnItems.find((i) => i.id === id);
        return makeJsonResponse(item ?? null);
      }
      return makeJsonResponse(null);
    });

    const items = await hackernewsAdapter.fetch(hnCfg());
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.title).toBe("string");
      expect(typeof item.url).toBe("string");
      expect(typeof item.source).toBe("string");
      expect(item.timestamp).toBeInstanceOf(Date);
      expect(item.source).toContain("hackernews");
    }
  });

});

describe("HN DB round-trip regression", () => {
  const mocks = useFetchMockSuite();
  installTempDbHooks({ prefix: "pace-hn-reg-" });

  test("HN items survive save+load through DB", async () => {
    const ids = [10, 20];
    const hnItems = ids.map((id) => makeHNItem(id, { score: 100 }));
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("topstories.json")) return makeJsonResponse(ids);
      const match = String(url).match(/item\/(\d+)\.json/);
      if (match) {
        const id = parseInt(match[1], 10);
        return makeJsonResponse(hnItems.find((i) => i.id === id) ?? null);
      }
      return makeJsonResponse(null);
    });

    const items = await hackernewsAdapter.fetch(hnCfg());
    expect(items.length).toBe(2);

    saveItems("hn-panel", items);
    const rows = getItemsByPanel("hn-panel", 50);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.panel_id).toBe("hn-panel");
      expect(row.source).toContain("hackernews");
    }
  });
});

// ---------------------------------------------------------------------------
// Angle 2d: Reddit adapter still works
// ---------------------------------------------------------------------------

describe("Reddit adapter regression", () => {
  const mocks = useFetchMockSuite();

  test("Reddit fetch returns items with expected fields", async () => {
    const posts = [
      makePost("abc", "Test Post 1", false, 200, "programming"),
      makePost("def", "Test Post 2", true, 150, "programming"),
    ];
    mocks.fetchMock.mockResolvedValue(makeListingResponse(posts));

    const items = await redditAdapter.fetch(
      redditCfg({ subreddits: ["programming"] }),
    );
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.title).toBe("string");
      expect(typeof item.url).toBe("string");
      expect(typeof item.source).toBe("string");
      expect(item.timestamp).toBeInstanceOf(Date);
      expect(item.source).toContain("reddit");
    }
  });

});

describe("Reddit DB round-trip regression", () => {
  const mocks = useFetchMockSuite();
  installTempDbHooks({ prefix: "pace-reddit-reg-" });

  test("Reddit items survive save+load through DB", async () => {
    const posts = [
      makePost("r1", "Reddit Post 1", false, 300, "webdev"),
      makePost("r2", "Reddit Post 2", true, 250, "webdev"),
    ];
    mocks.fetchMock.mockResolvedValue(makeListingResponse(posts));

    const items = await redditAdapter.fetch(
      redditCfg({ subreddits: ["webdev"] }),
    );
    expect(items.length).toBe(2);

    saveItems("reddit-panel", items);
    const rows = getItemsByPanel("reddit-panel", 50);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.panel_id).toBe("reddit-panel");
      expect(row.source).toContain("reddit");
    }
  });
});

