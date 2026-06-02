import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import hackernewsAdapter from "./adapters/hackernews";
import type { AdapterConfig } from "./adapters/types";
import * as typesMod from "./adapters/types";

const originalFetch = globalThis.fetch;

const defaultCfg: AdapterConfig = { type: "hackernews" };

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

describe("hackernews adapter", () => {
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  test("fetches default top feed and maps items with body", async () => {
    const ids = [1, 2, 3];
    const items = ids.map((id) => makeHNItem(id, { score: 50 + id }));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      const match = url.match(/item\/(\d+)\.json/);
      if (match) {
        const id = parseInt(match[1], 10);
        return makeItemResponse(items.find((i) => i.id === id) || null);
      }
      return makeItemResponse(null);
    });

    const results = await hackernewsAdapter.fetch(defaultCfg);

    expect(results).toHaveLength(3);
    expect(results[0].id).toBe("hn:1");
    expect(results[0].title).toBe("Story 1");
    expect(results[0].source).toBe("hackernews:top");
    expect(results[0].body).toContain("51 points");
    expect(results[0].body).toContain("by testuser");
  });

  test("supports feed aliases (newest, frontpage, ask_hn, show_hn, jobs)", async () => {
    const ids = [10];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("stories.json")) {
        return makeIdsResponse(ids);
      }
      const match = url.match(/item\/(\d+)\.json/);
      if (match) return makeItemResponse(makeHNItem(10));
      return makeItemResponse(null);
    });

    const r1 = await hackernewsAdapter.fetch({ type: "hackernews", params: { feed: "newest" } });
    expect(r1[0].source).toBe("hackernews:new");

    const r2 = await hackernewsAdapter.fetch({ type: "hackernews", params: { stories: "frontpage" } });
    expect(r2[0].source).toBe("hackernews:top");

    const r3 = await hackernewsAdapter.fetch({ type: "hackernews", params: { feed: "ask_hn" } });
    expect(r3[0].source).toBe("hackernews:ask");

    const r4 = await hackernewsAdapter.fetch({ type: "hackernews", params: { feed: "show_hn" } });
    expect(r4[0].source).toBe("hackernews:show");

    const r5 = await hackernewsAdapter.fetch({ type: "hackernews", params: { feed: "jobs" } });
    expect(r5[0].source).toBe("hackernews:job");
  });

  test("applies minScore by fetching extra items then filtering + respects limit", async () => {
    const ids = [1, 2, 3, 4, 5];
    fetchMock.mockImplementation(async (url: string) => {
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

    const cfg: AdapterConfig = {
      type: "hackernews",
      params: { min_score: 50, limit: 2 },
    };
    const results = await hackernewsAdapter.fetch(cfg);

    // should have fetched extra (limit*3=6 but only 5), filtered to >=50 (3 items), then limited to 2
    expect(results).toHaveLength(2);
    expect(results.every((r) => (r.body.match(/(\d+) points/)?.[1] ?? 0) >= 50)).toBe(true);
  });

  test("respects limit after score filter", async () => {
    const ids = [1, 2, 3];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories")) return makeIdsResponse(ids);
      const m = url.match(/item\/(\d+)/);
      return makeItemResponse(m ? makeHNItem(parseInt(m[1])) : null);
    });

    const cfg: AdapterConfig = { type: "hackernews", params: { limit: 1 } };
    const results = await hackernewsAdapter.fetch(cfg);
    expect(results).toHaveLength(1);
  });

  test("throws on HTTP !ok for feed list with exact prefixed message", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 500 }));

    const cfg: AdapterConfig = { type: "hackernews", params: { feed: "top" } };
    await expect(hackernewsAdapter.fetch(cfg)).rejects.toThrow(
      /hackernews: failed to fetch topstories: 500/,
    );
  });

  test("throws on network/fetch reject (wrapped via errorMessage)", async () => {
    fetchMock.mockRejectedValue(new Error("DNS fail"));

    await expect(hackernewsAdapter.fetch(defaultCfg)).rejects.toThrow(
      /hackernews: error fetching stories: DNS fail/,
    );
  });

  test("handles items with missing optional fields (title fallback, no url, no score)", async () => {
    const ids = [99];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories")) return makeIdsResponse(ids);
      return makeItemResponse({ id: 99 });
    });

    const results = await hackernewsAdapter.fetch(defaultCfg);
    expect(results[0].title).toBe("(untitled)");
    expect(results[0].url).toBe("https://news.ycombinator.com/item?id=99");
    expect(results[0].body).toBe(""); // no parts
  });

  test("batches large id lists (BATCH_SIZE internal)", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("topstories.json")) return makeIdsResponse(ids);
      const m = url.match(/item\/(\d+)\.json/);
      if (m) return makeItemResponse(makeHNItem(parseInt(m[1])));
      return makeItemResponse(null);
    });

    const cfg: AdapterConfig = { type: "hackernews", params: { limit: 25 } };
    const results = await hackernewsAdapter.fetch(cfg);
    expect(results).toHaveLength(25);
    // at least 3 batch calls for items (10+10+5)
    const itemCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("/item/"),
    ).length;
    expect(itemCalls).toBe(25);
  });

  test("uses errorMessage helper (via sh1 duck) for !ok feed list status errors (mmu contract, closes raw status gap; also ngb shape)", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 500 }));

    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      const cfg: AdapterConfig = { type: "hackernews", params: { feed: "top" } };
      await expect(hackernewsAdapter.fetch(cfg)).rejects.toThrow(
        /hackernews: failed to fetch topstories: 500/,
      );
      expect(emSpy).toHaveBeenCalledWith({ message: "500" });
    } finally {
      emSpy.mockRestore();
    }
  });
});