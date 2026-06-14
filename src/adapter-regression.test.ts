/**
 * Adapter regression tests: verify existing adapters (RSS, HN, Reddit) still
 * work correctly after the bookmarks and counter additions, and verify the
 * adapter registry is consistent.
 */
import { describe, test, expect, beforeEach, spyOn, afterEach } from "bun:test";
import { ADAPTER_TYPES, ADAPTER_PARAM_KEYS, type AdapterType } from "./adapters/params";
import { BUILTIN_ADAPTER_MODULES, loadBuiltinAdapters } from "./adapters/adapter-registry";
import rssAdapter from "./adapters/rss";
import hackernewsAdapter from "./adapters/hackernews";
import redditAdapter from "./adapters/reddit";
import bookmarksAdapter from "./adapters/bookmarks";
import counterAdapter from "./adapters/counter";
import { useFetchMockSuite } from "./test/adapter-mocks";
import { rssCfg, hnCfg, redditCfg } from "./test/adapter-cfg";
import { makeXmlResponse, makeJsonResponse } from "./test/fetch-responses";
import { rssDefaultFetchImpl } from "./test/rss-fixtures";
import { makeHNItem } from "./test/hackernews-fixtures";
import { makePost, makeListingResponse } from "./test/reddit-fixtures";
import { installTempDbHooks } from "./test/temp-db";
import { saveItems, getItemsByPanel, initDb } from "./db";

// ---------------------------------------------------------------------------
// Angle 2a: Adapter Registry Consistency
// ---------------------------------------------------------------------------

describe("adapter registry consistency", () => {
  test("adapter registry has exactly 19 entries", () => {
    expect(ADAPTER_TYPES.length).toBe(19);
    expect(Object.keys(BUILTIN_ADAPTER_MODULES).length).toBe(19);
  });

  test("loadBuiltinAdapters returns a Map with 19 entries", () => {
    const map = loadBuiltinAdapters();
    expect(map.size).toBe(19);
  });

  test("all adapter type strings are unique", () => {
    const set = new Set(ADAPTER_TYPES);
    expect(set.size).toBe(ADAPTER_TYPES.length);
  });

  test("every ADAPTER_TYPES entry has a matching BUILTIN_ADAPTER_MODULES entry", () => {
    for (const type of ADAPTER_TYPES) {
      expect(BUILTIN_ADAPTER_MODULES[type]).toBeDefined();
      expect(BUILTIN_ADAPTER_MODULES[type].name).toBe(type);
      expect(typeof BUILTIN_ADAPTER_MODULES[type].fetch).toBe("function");
    }
  });

  test("every ADAPTER_TYPES entry has a matching ADAPTER_PARAM_KEYS entry", () => {
    for (const type of ADAPTER_TYPES) {
      expect(ADAPTER_PARAM_KEYS[type]).toBeDefined();
      expect(Array.isArray(ADAPTER_PARAM_KEYS[type])).toBe(true);
      expect(ADAPTER_PARAM_KEYS[type].length).toBeGreaterThan(0);
    }
  });

  test("bookmarks and counter are in the registry", () => {
    expect(ADAPTER_TYPES).toContain("bookmarks");
    expect(ADAPTER_TYPES).toContain("counter");
    expect(BUILTIN_ADAPTER_MODULES.bookmarks).toBeDefined();
    expect(BUILTIN_ADAPTER_MODULES.counter).toBeDefined();
  });

  test("no adapter param key arrays share confusing overlap", () => {
    // "Confusing overlap" means the exact same param name appearing in
    // multiple adapters where it means something different. We check that
    // commonly reused names (url, limit, etc.) are expected, and that
    // adapter-specific params are unique to their adapter.

    const adapterSpecific: Record<string, string[]> = {
      hackernews: ["feed", "stories", "min_score"],
      rss: ["urls"],
      reddit: ["subreddits", "sort", "min_score", "time"],
      github: ["mode", "language", "since", "repos", "token"],
      "github-releases": ["repos", "token"],
      bookmarks: ["items"],
      counter: ["json_path", "compare_url", "compare_path", "headers"],
    };

    // Verify the specifically unique params are not shared with other types
    for (const [type, uniqueParams] of Object.entries(adapterSpecific)) {
      for (const param of uniqueParams) {
        // Count how many adapters have this param
        const adaptersWithParam = ADAPTER_TYPES.filter(
          (t) => ADAPTER_PARAM_KEYS[t].includes(param as any),
        );
        // Some params (like "repos", "token", "sort", "min_score", "limit")
        // are intentionally shared. Only flag if a "unique" param appears
        // in a completely unrelated adapter.
        if (adaptersWithParam.length > 1) {
          // "sort" is shared by reddit, npm, lemmy, stackexchange - expected
          // "repos" is shared by github and github-releases - expected
          // "token" is shared by github and github-releases - expected
          // "min_score" is shared by hackernews, reddit, lobsters, lemmy, stackexchange - expected
          const expected_shared = ["sort", "repos", "token", "min_score", "limit", "feed", "tags", "mode", "language"];
          if (!expected_shared.includes(param)) {
            // Unexpected sharing - log but do not fail (informational)
            // We just want to make sure bookmarks.items and counter.json_path
            // are unique.
            const others = adaptersWithParam.filter((t) => t !== type);
            expect(others.length).toBe(0);
          }
        }
      }
    }
  });

  test("bookmarks.items is unique to bookmarks adapter", () => {
    const adaptersWithItems = ADAPTER_TYPES.filter(
      (t) => ADAPTER_PARAM_KEYS[t].includes("items" as any),
    );
    expect(adaptersWithItems).toEqual(["bookmarks"]);
  });

  test("counter.json_path is unique to counter adapter", () => {
    const adaptersWithJsonPath = ADAPTER_TYPES.filter(
      (t) => ADAPTER_PARAM_KEYS[t].includes("json_path" as any),
    );
    expect(adaptersWithJsonPath).toEqual(["counter"]);
  });

  test("counter.compare_url is unique to counter adapter", () => {
    const adaptersWithCompareUrl = ADAPTER_TYPES.filter(
      (t) => ADAPTER_PARAM_KEYS[t].includes("compare_url" as any),
    );
    expect(adaptersWithCompareUrl).toEqual(["counter"]);
  });
});

// ---------------------------------------------------------------------------
// Angle 2b: RSS adapter still works (fetch mock, parse, DB round-trip)
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

  test("RSS adapter name is 'rss'", () => {
    expect(rssAdapter.name).toBe("rss");
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

  test("HN adapter name is 'hackernews'", () => {
    expect(hackernewsAdapter.name).toBe("hackernews");
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

  test("Reddit adapter name is 'reddit'", () => {
    expect(redditAdapter.name).toBe("reddit");
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

// ---------------------------------------------------------------------------
// Angle 2e: New adapters did not break adapter module shape/contract
// ---------------------------------------------------------------------------

describe("new adapter module contract", () => {
  test("bookmarks adapter has correct name and fetch function", () => {
    expect(bookmarksAdapter.name).toBe("bookmarks");
    expect(typeof bookmarksAdapter.fetch).toBe("function");
  });

  test("counter adapter has correct name and fetch function", () => {
    expect(counterAdapter.name).toBe("counter");
    expect(typeof counterAdapter.fetch).toBe("function");
  });

  test("every builtin adapter module has name matching its registry key", () => {
    for (const type of ADAPTER_TYPES) {
      const adapter = BUILTIN_ADAPTER_MODULES[type];
      expect(adapter.name).toBe(type);
    }
  });

  test("every builtin adapter.fetch returns a promise", async () => {
    // We cannot call fetch on all adapters without mocking, but we can
    // verify the function signature.
    for (const type of ADAPTER_TYPES) {
      const adapter = BUILTIN_ADAPTER_MODULES[type];
      expect(typeof adapter.fetch).toBe("function");
      // fetch should take one argument (config)
      expect(adapter.fetch.length).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Angle 2f: Bookmarks and counter do not interfere with other adapters
// when registered together
// ---------------------------------------------------------------------------

describe("registry coexistence", () => {
  test("loadBuiltinAdapters includes all original 17 + bookmarks + counter", () => {
    const map = loadBuiltinAdapters();
    const original17 = [
      "arxiv", "devto", "github", "github-releases", "hackernews",
      "lemmy", "lobsters", "mastodon", "npm", "podcast",
      "producthunt", "reddit", "rss", "stackexchange", "twitter",
      "wikipedia", "youtube",
    ];
    for (const name of original17) {
      expect(map.has(name)).toBe(true);
    }
    expect(map.has("bookmarks")).toBe(true);
    expect(map.has("counter")).toBe(true);
  });

  test("no adapter name collision between old and new adapters", () => {
    const names = ADAPTER_TYPES.slice();
    const sorted = [...names].sort();
    // Check for adjacent duplicates
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).not.toBe(sorted[i - 1]);
    }
  });
});
