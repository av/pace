import { describe, test, expect, spyOn } from "bun:test";
import hackernewsAdapter from "./adapters/hackernews";
import * as typesMod from "./adapters/types";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const hnCfg = (params: Record<string, unknown> = {}) => adapterCfg("hackernews", params);

interface HNItemFixture {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  time?: number;
  by?: string;
  descendants?: number;
}

function makeHNItem(id: number, overrides: Partial<HNItemFixture> = {}): HNItemFixture {
  return {
    id,
    title: `Story ${id}`,
    url: `https://example.com/story-${id}`,
    score: 100 + id,
    time: 1716200000 + id,
    by: "testuser",
    descendants: 5,
    ...overrides,
  };
}

function makeIdsResponse(ids: number[]): Response {
  return new Response(JSON.stringify(ids), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeItemResponse(item: HNItemFixture | null, status = 200): Response {
  return new Response(JSON.stringify(item), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("hackernews", () => {
  test("fetches default top feed and maps items with body", async () => {
    const ids = [1, 2, 3];
    const items = ids.map((id) => makeHNItem(id, { score: 50 + id }));
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) {
        const id = parseInt(match[1], 10);
        return makeItemResponse(items.find((i) => i.id === id) || null);
      }
      return makeItemResponse(null);
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
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeItemResponse(makeHNItem(1));
      return makeItemResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg({ type: "   " }));
    expect(results[0].source).toBe("hackernews:top");
    expect(mocks.fetchMock.mock.calls[0][0]).toContain("topstories.json");
  });

  test("trims whitespace from configured type", async () => {
    const ids = [2];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("newstories.json")) return makeIdsResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeItemResponse(makeHNItem(2));
      return makeItemResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg({ type: "  new  " }));
    expect(results[0].source).toBe("hackernews:new");
    expect(mocks.fetchMock.mock.calls[0][0]).toContain("newstories.json");
  });

  test("type takes precedence over feed and stories", async () => {
    const ids = [3];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("beststories.json")) return makeIdsResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeItemResponse(makeHNItem(3));
      return makeItemResponse(null);
    });

    const results = await hackernewsAdapter.fetch(
      hnCfg({ type: "best", feed: "new", stories: "ask" }),
    );
    expect(results[0].source).toBe("hackernews:best");
    expect(mocks.fetchMock.mock.calls[0][0]).toContain("beststories.json");
  });

  test("supports feed aliases (newest, frontpage, ask_hn, show_hn, jobs)", async () => {
    const ids = [10];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("stories.json")) {
        return makeIdsResponse(ids);
      }
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeItemResponse(makeHNItem(10));
      return makeItemResponse(null);
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
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) {
        const id = parseInt(match[1], 10);
        // low scores for some
        const score = id <= 2 ? 5 : 100 + id;
        return makeItemResponse(makeHNItem(id, { score }));
      }
      return makeItemResponse(null);
    });

    const cfg = hnCfg({ min_score: 50, limit: 2 });
    const results = await hackernewsAdapter.fetch(cfg);

    // should have fetched extra (limit*3=6 but only 5), filtered to >=50 (3 items), then limited to 2
    expect(results).toHaveLength(2);
    expect(results.every((r) => (r.body.match(/(\d+) points/)?.[1] ?? 0) >= 50)).toBe(true);
  });

  test.each([NaN, "50", Infinity, -5] as unknown[])(
    "invalid min_score (%s) treated as 0 (no score filter)",
    async (min_score) => {
      const ids = [1, 2];
      mocks.fetchMock.mockImplementation(async (url: string) => {
        if (url.includes("topstories.json")) return makeIdsResponse(ids);
        const match = url.match(/item\/(\d+)\.json/);
        if (match) {
          const id = parseInt(match[1], 10);
          return makeItemResponse(makeHNItem(id, { score: id === 1 ? 5 : 100 }));
        }
        return makeItemResponse(null);
      });

      const results = await hackernewsAdapter.fetch(hnCfg({ min_score, limit: 10 }));

      expect(results).toHaveLength(2);
    },
  );

  test.each([NaN, "30", Infinity, -5, 0] as unknown[])(
    "invalid limit (%s) uses default fetch slice of 30",
    async (limit) => {
      const ids = Array.from({ length: 40 }, (_, i) => i + 1);
      mocks.fetchMock.mockImplementation(async (url: string) => {
        if (url.includes("topstories.json")) return makeIdsResponse(ids);
        const m = url.match(/item\/(\d+)\.json/);
        if (m) return makeItemResponse(makeHNItem(parseInt(m[1], 10)));
        return makeItemResponse(null);
      });

      const results = await hackernewsAdapter.fetch(hnCfg({ limit }));
      expect(results).toHaveLength(30);
    },
  );

  test("caps limit at 200", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      const m = url.match(/item\/(\d+)\.json/);
      if (m) return makeItemResponse(makeHNItem(parseInt(m[1], 10)));
      return makeItemResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg({ limit: 500 }));
    expect(results).toHaveLength(200);
  });

  test("floors fractional limit", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      const m = url.match(/item\/(\d+)\.json/);
      if (m) return makeItemResponse(makeHNItem(parseInt(m[1], 10)));
      return makeItemResponse(null);
    });

    const results = await hackernewsAdapter.fetch(hnCfg({ limit: 7.9 }));
    expect(results).toHaveLength(7);
  });

  test("respects limit after score filter", async () => {
    const ids = [1, 2, 3];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories")) return makeIdsResponse(ids);
      const m = url.match(/item\/(\d+)/);
      return makeItemResponse(m ? makeHNItem(parseInt(m[1])) : null);
    });

    const cfg = hnCfg({ limit: 1 });
    const results = await hackernewsAdapter.fetch(cfg);
    expect(results).toHaveLength(1);
  });

  test("throws on HTTP !ok for feed list with exact prefixed message", async () => {
    mocks.fetchMock.mockResolvedValue(new Response("[]", { status: 500 }));

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
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      return makeItemResponse(
        makeHNItem(42, { title: "A &amp; B &#8364; C" }),
      );
    });

    const results = await hackernewsAdapter.fetch(hnCfg());
    expect(results[0].title).toBe("A & B € C");
  });

  test("handles items with missing optional fields (title fallback, no url, no score)", async () => {
    const ids = [99];
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories")) return makeIdsResponse(ids);
      return makeItemResponse({ id: 99 });
    });

    const results = await hackernewsAdapter.fetch(hnCfg());
    expect(results[0].title).toBe("(untitled)");
    expect(results[0].url).toBe("https://news.ycombinator.com/item?id=99");
    expect(results[0].body).toBe(""); // no parts
  });

  test("batches large id lists (BATCH_SIZE internal)", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      const m = url.match(/item\/(\d+)\.json/);
      if (m) return makeItemResponse(makeHNItem(parseInt(m[1])));
      return makeItemResponse(null);
    });

    const cfg = hnCfg({ limit: 25 });
    const results = await hackernewsAdapter.fetch(cfg);
    expect(results).toHaveLength(25);
    // at least 3 batch calls for items (10+10+5)
    const itemCalls = mocks.fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("/item/"),
    ).length;
    expect(itemCalls).toBe(25);
  });

  test("errorMessage on !ok", async () => {
    mocks.fetchMock.mockResolvedValue(new Response("[]", { status: 500 }));

    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      const cfg = hnCfg({ feed: "top" });
      await expect(hackernewsAdapter.fetch(cfg)).rejects.toThrow(
        /hackernews: failed to fetch topstories: HTTP error 500/,
      );
      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 500" });
    } finally {
      emSpy.mockRestore();
    }
  });
});