import { describe, test, expect } from "bun:test";
import hackernewsAdapter, {
  hackernewsSourceLabel,
  resolveHnFeedType,
} from "./adapters/hackernews";
import {
  expectAdapterFetchError,
  fetchMockCallUrl,
  fetchMockCalls,
  useFetchMockSuite,
} from "./test/adapter-mocks";
import { hnCfg } from "./test/adapter-cfg";
import { makeErrorResponse, makeJsonResponse } from "./test/fetch-responses";
import { invalidLimitParams, invalidMinScoreParams } from "./test/invalid-params";
import { makeHNItem } from "./test/hackernews-fixtures";

const mocks = useFetchMockSuite();


describe("hackernewsSourceLabel", () => {
  test.each([
    ["top", "hackernews:top"],
    ["new", "hackernews:new"],
    ["best", "hackernews:best"],
    ["ask", "hackernews:ask"],
    ["show", "hackernews:show"],
    ["job", "hackernews:job"],
  ] as const)("maps %s → %s", (feedType, expected) => {
    expect(hackernewsSourceLabel(feedType)).toBe(expected);
  });
});

describe("resolveHnFeedType", () => {
  test.each([
    ["top", "top"],
    ["NEW", "new"],
    ["Best", "best"],
    ["newest", "new"],
    ["recent", "new"],
    ["front", "top"],
    ["frontpage", "top"],
    ["askhn", "ask"],
    ["ask_hn", "ask"],
    ["showhn", "show"],
    ["show_hn", "show"],
    ["jobs", "job"],
    ["unknown-feed", "top"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(resolveHnFeedType(input)).toBe(expected);
  });
});

describe("hackernews", () => {
  test("fetches default top feed and maps items with body", async () => {
    const ids = [1, 2, 3];
    const items = ids.map((id) => makeHNItem(id, { score: 50 + id }));
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeJsonResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) {
        const id = parseInt(match[1], 10);
        return makeJsonResponse(items.find((i) => i.id === id) || null);
      }
      return makeJsonResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg());

    expect(results).toHaveLength(3);
    expect(results[0].id).toBe("hn:1");
    expect(results[0].title).toBe("Story 1");
    expect(results[0].source).toBe("hackernews:top");
    expect(results[0].body).toContain("51 points");
    expect(results[0].body).toContain("by testuser");
  });

  test("blank-only type uses default top", async () => {
    const ids = [1];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeJsonResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeJsonResponse(makeHNItem(1));
      return makeJsonResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg({ type: "   " }));
    expect(results[0].source).toBe("hackernews:top");
    expect(fetchMockCallUrl(mocks.fetchMock)).toContain("topstories.json");
  });

  test("trims whitespace from configured type", async () => {
    const ids = [2];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("newstories.json")) return makeJsonResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeJsonResponse(makeHNItem(2));
      return makeJsonResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg({ type: "  new  " }));
    expect(results[0].source).toBe("hackernews:new");
    expect(fetchMockCallUrl(mocks.fetchMock)).toContain("newstories.json");
  });

  test("type takes precedence over feed and stories", async () => {
    const ids = [3];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("beststories.json")) return makeJsonResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeJsonResponse(makeHNItem(3));
      return makeJsonResponse(null);
    });

    const results = await hackernewsAdapter.fetch(
      hnCfg({ type: "best", feed: "new", stories: "ask" }),
    );
    expect(results[0].source).toBe("hackernews:best");
    expect(fetchMockCallUrl(mocks.fetchMock)).toContain("beststories.json");
  });

  test("supports feed aliases (newest, frontpage, ask_hn, show_hn, jobs)", async () => {
    const ids = [10];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("stories.json")) {
        return makeJsonResponse(ids);
      }
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeJsonResponse(makeHNItem(10));
      return makeJsonResponse(null);
    });

    const r1 = await hackernewsAdapter.fetch(hnCfg({ feed: "newest" }));
    expect(r1[0].source).toBe("hackernews:new");

    const r2 = await hackernewsAdapter.fetch(hnCfg({ stories: "frontpage" }));
    expect(r2[0].source).toBe("hackernews:top");

    const r3 = await hackernewsAdapter.fetch(hnCfg({ feed: "ask_hn" }));
    expect(r3[0].source).toBe("hackernews:ask");

    const r4 = await hackernewsAdapter.fetch(hnCfg({ feed: "show_hn" }));
    expect(r4[0].source).toBe("hackernews:show");

    const r5 = await hackernewsAdapter.fetch(hnCfg({ feed: "jobs" }));
    expect(r5[0].source).toBe("hackernews:job");
  });

  test("applies minScore by fetching extra items then filtering + respects limit", async () => {
    const ids = [1, 2, 3, 4, 5];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeJsonResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) {
        const id = parseInt(match[1], 10);
        // low scores for some
        const score = id <= 2 ? 5 : 100 + id;
        return makeJsonResponse(makeHNItem(id, { score }));
      }
      return makeJsonResponse(null);
    });

    const cfg = hnCfg({ min_score: 50, limit: 2 });
    const results = await hackernewsAdapter.fetch(cfg);

    // should have fetched extra (limit*3=6 but only 5), filtered to >=50 (3 items), then limited to 2
    expect(results).toHaveLength(2);
    expect(results.every((r) => (r.body.match(/(\d+) points/)?.[1] ?? 0) >= 50)).toBe(true);
  });

  test.each(invalidMinScoreParams(50))(
    "invalid min_score (%s) treated as 0 (no score filter)",
    async (min_score) => {
      const ids = [1, 2];
      mocks.fetchMock.mockImplementation(async (url: string) => {
        if (url.includes("topstories.json")) return makeJsonResponse(ids);
        const match = url.match(/item\/(\d+)\.json/);
        if (match) {
          const id = parseInt(match[1], 10);
          return makeJsonResponse(makeHNItem(id, { score: id === 1 ? 5 : 100 }));
        }
        return makeJsonResponse(null);
      });

      const results = await hackernewsAdapter.fetch(hnCfg({ min_score, limit: 10 }));

      expect(results).toHaveLength(2);
    },
  );

  test.each(invalidLimitParams(30))(
    "invalid limit (%s) uses default fetch slice of 30",
    async (limit) => {
      const ids = Array.from({ length: 40 }, (_, i) => i + 1);
      mocks.fetchMock.mockImplementation(async (url: string) => {
        if (url.includes("topstories.json")) return makeJsonResponse(ids);
        const m = url.match(/item\/(\d+)\.json/);
        if (m) return makeJsonResponse(makeHNItem(parseInt(m[1], 10)));
        return makeJsonResponse(null);
      });

      const results = await hackernewsAdapter.fetch(hnCfg({ limit }));
      expect(results).toHaveLength(30);
    },
  );

  test("caps limit at 200", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeJsonResponse(ids);
      const m = url.match(/item\/(\d+)\.json/);
      if (m) return makeJsonResponse(makeHNItem(parseInt(m[1], 10)));
      return makeJsonResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg({ limit: 500 }));
    expect(results).toHaveLength(200);
  });

  test("floors fractional limit", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeJsonResponse(ids);
      const m = url.match(/item\/(\d+)\.json/);
      if (m) return makeJsonResponse(makeHNItem(parseInt(m[1], 10)));
      return makeJsonResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg({ limit: 7.9 }));
    expect(results).toHaveLength(7);
  });

  test("respects limit after score filter", async () => {
    const ids = [1, 2, 3];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories")) return makeJsonResponse(ids);
      const m = url.match(/item\/(\d+)/);
      return makeJsonResponse(m ? makeHNItem(parseInt(m[1])) : null);
    });

    const cfg = hnCfg({ limit: 1 });
    const results = await hackernewsAdapter.fetch(cfg);
    expect(results).toHaveLength(1);
  });

  test("throws on HTTP !ok for feed list with exact prefixed message", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(500));

    const cfg = hnCfg({ feed: "top" });
    await expect(hackernewsAdapter.fetch(cfg)).rejects.toThrow(
      /hackernews: failed to fetch topstories: HTTP error 500/,
    );
  });

  test("throws on network/fetch reject (wrapped via errorMessage)", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("DNS fail"));

    await expect(hackernewsAdapter.fetch(hnCfg())).rejects.toThrow(
      /hackernews: error fetching topstories: DNS fail/,
    );
  });

  test("decodes HTML entities in item titles from API", async () => {
    const ids = [42];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeJsonResponse(ids);
      return makeJsonResponse(
        makeHNItem(42, { title: "A &amp; B &#8364; C" }),
      );
    });

    const results = await hackernewsAdapter.fetch(hnCfg());
    expect(results[0].title).toBe("A & B € C");
  });

  test("handles items with missing optional fields (title fallback, no url, no score)", async () => {
    const ids = [99];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories")) return makeJsonResponse(ids);
      return makeJsonResponse({ id: 99 });
    });

    const results = await hackernewsAdapter.fetch(hnCfg());
    expect(results[0].title).toBe("(untitled)");
    expect(results[0].url).toBe("https://news.ycombinator.com/item?id=99");
    expect(results[0].body).toBe(""); // no parts
  });

  test("batches large id lists (BATCH_SIZE internal)", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeJsonResponse(ids);
      const m = url.match(/item\/(\d+)\.json/);
      if (m) return makeJsonResponse(makeHNItem(parseInt(m[1])));
      return makeJsonResponse(null);
    });

    const cfg = hnCfg({ limit: 25 });
    const results = await hackernewsAdapter.fetch(cfg);
    expect(results).toHaveLength(25);
    // at least 3 batch calls for items (10+10+5)
    const itemCalls = fetchMockCalls(mocks.fetchMock).filter((c) =>
      c.url.includes("/item/"),
    ).length;
    expect(itemCalls).toBe(25);
  });

  test("errorMessage on !ok", async () => {
    const cfg = hnCfg({ feed: "top" });
    await expectAdapterFetchError(mocks.fetchMock, {
      httpStatus: 500,
      fetch: () => hackernewsAdapter.fetch(cfg),
      throwMatcher: /hackernews: failed to fetch topstories: HTTP error 500/,
      spy: { message: "HTTP error 500" },
    });
  });

  test("warns and returns [] when story ID list response is not a JSON array", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) {
        return makeJsonResponse({ error: "unexpected shape" });
      }
      return makeJsonResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg());

    expect(results).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "hackernews: expected JSON array for topstories (got object), treating as empty",
    );
  });
});