import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import producthuntAdapter from "./adapters/producthunt";
import type { AdapterConfig } from "./adapters/types";
import * as typesMod from "./adapters/types";

const originalFetch = globalThis.fetch;

const defaultCfg: AdapterConfig = { type: "producthunt" };

function producthuntCfg(params: Record<string, unknown> = {}): AdapterConfig {
  return { ...defaultCfg, params };
}

function makePHFeedFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:www.producthunt.com,2005:Post/123456</id>
    <title>Test Product</title>
    <content type="html">&lt;p&gt;Cool new AI tool tagline&lt;/p&gt;&lt;p&gt;&lt;a href="https://www.producthunt.com/r/test-product-123456"&gt;Link&lt;/a&gt;&lt;/p&gt;</content>
    <link rel="alternate" href="https://www.producthunt.com/posts/test-product-123456" />
    <published>2024-05-20T10:00:00Z</published>
    <author><name>John Doe</name></author>
  </entry>
  <entry>
    <id>tag:www.producthunt.com,2005:Post/789012</id>
    <title>Another Great Product</title>
    <content>&lt;p&gt;Second tagline here&lt;/p&gt;</content>
    <link href="https://www.producthunt.com/posts/another-great-product-789012" />
    <published>2024-05-21T12:00:00Z</published>
    <author><name>Jane Smith</name></author>
  </entry>
</feed>`;
}

function makeEnrichHtml(upvotes: number, comments: number, topics: string[] = ["ai"], makers: string[] = ["johndoe"]): string {
  const topicsHtml = topics.map(t => `<a href="/topics/${t.replace(/\s+/g, "-")}">${t}</a>`).join("");
  const makersHtml = makers.map(m => `<a href="/@${m}">@${m}</a>`).join("");
  return `<html><body>
    <div>Upvote • ${upvotes} points</div>
    <script>var x = {"commentsCount": ${comments}};</script>
    ${topicsHtml}
    ${makersHtml}
  </body></html>`;
}

describe("producthunt adapter (DRY quality + test coverage)", () => {
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof spyOn>;

  test("satisfies ngb contract: default export has .name and .fetch", () => {
    expect(producthuntAdapter.name).toBe("producthunt");
    expect(typeof producthuntAdapter.fetch).toBe("function");
  });

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("fetches feed and maps basic items with correct id/source/timestamp/body (no enrich)", async () => {
    fetchMock.mockResolvedValue(
      new Response(makePHFeedFixture(), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      }),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = String(fetchMock.mock.calls[0][0]);
    expect(callUrl).toBe("https://www.producthunt.com/feed");

    expect(items.length).toBe(2);
    expect(items[0].id).toBe("ph:123456");
    expect(items[0].title).toBe("Test Product");
    expect(items[0].url).toContain("test-product-123456");
    expect(items[0].source).toBe("producthunt");
    expect(items[0].timestamp).toBeInstanceOf(Date);
    expect(items[0].body).toContain("Cool new AI tool tagline");
    expect(items[0].body).toContain("by John Doe");
    expect(items[0].body).not.toContain("upvotes");
  });

  test("respects limit param (caps at 50)", async () => {
    fetchMock.mockResolvedValue(
      new Response(makePHFeedFixture(), { status: 200 }),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg({ limit: 1 }));

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Test Product");
  });

  test("with enrich=true performs per-product fetches and includes upvotes/comments/topics/makers in body", async () => {
    let callCount = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      callCount++;
      if (u.includes("producthunt.com/feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      // enrich calls for the two product pages
      if (u.includes("123456")) {
        return new Response(makeEnrichHtml(215, 67, ["ai", "devtools"], ["johndoe"]), { status: 200 });
      }
      return new Response(makeEnrichHtml(42, 12, ["design"], ["janesmith"]), { status: 200 });
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(callCount).toBe(3); // 1 feed + 2 enrich
    expect(items.length).toBe(2);
    expect(items[0].body).toContain("215 upvotes");
    expect(items[0].body).toContain("67 comments");
    expect(items[0].body).toContain("topics: Ai, Devtools");
    expect(items[0].body).toContain("by @johndoe");
    expect(items[0].body).toContain("site: https://www.producthunt.com/r/test-product-123456");
  });

  test("with enrich + min_upvotes filters items below threshold", async () => {
    let call = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      call++;
      if (u.includes("feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      if (u.includes("123456")) {
        return new Response(makeEnrichHtml(50, 10), { status: 200 });
      }
      return new Response(makeEnrichHtml(300, 99), { status: 200 });
    });

    const items = await producthuntAdapter.fetch(
      producthuntCfg({ enrich: true, min_upvotes: 100, limit: 10 }),
    );

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Another Great Product");
    expect(items[0].body).toContain("300 upvotes");
  });

  test("warns and returns [] when feed has no entries", async () => {
    const emptyFeed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    fetchMock.mockResolvedValue(new Response(emptyFeed, { status: 200 }));

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(items).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith("producthunt: no entries found in feed");
  });

  test("throws on HTTP !ok from feed (propagates with producthunt: prefix)", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(
      producthuntAdapter.fetch(producthuntCfg()),
    ).rejects.toThrow(/producthunt: failed to fetch feed: 429/);

    const hasStatusObjCall = emSpy.mock.calls.some((call: unknown[]) => {
      const arg = call[0];
      return arg && typeof arg === "object" && arg !== null && "message" in arg && String((arg as { message: string }).message) === "429";
    });
    expect(hasStatusObjCall).toBe(true);
    emSpy.mockRestore();
  });

  test("throws on network reject from feed (wrapped)", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      producthuntAdapter.fetch(producthuntCfg({ limit: 5 })),
    ).rejects.toThrow(/producthunt: error fetching feed: connection refused/);
  });

  test("enrich failures (null) are tolerated and items still returned without extra data", async () => {
    let c = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      c++;
      if (u.includes("feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      return new Response("<html>no data</html>", { status: 200 }); // !ok? no, but no matches -> null
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items.length).toBe(2);
    expect(items[0].body).not.toContain("upvotes");
    expect(items[0].body).toContain("Cool new AI tool tagline");
  });

  test("warns on enrich HTTP failure and still returns items without enrich data", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items.length).toBe(2);
    expect(items[0].body).not.toContain("upvotes");
    const enrichWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith("producthunt: enrich failed for"),
    );
    expect(enrichWarns).toHaveLength(2);
    expect(enrichWarns[0][0]).toMatch(
      /producthunt: enrich failed for https:\/\/www\.producthunt\.com\/posts\/test-product-123456: 404/,
    );
  });

  test("warns on enrich network failure and still returns items without enrich data", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      throw new Error("enrich connection refused");
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items.length).toBe(2);
    const enrichWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith("producthunt: enrich failed for"),
    );
    expect(enrichWarns).toHaveLength(2);
    expect(enrichWarns[0][0]).toBe(
      "producthunt: enrich failed for https://www.producthunt.com/posts/test-product-123456: enrich connection refused",
    );
  });
});
