import { describe, test, expect, spyOn } from "bun:test";
import producthuntAdapter from "./adapters/producthunt";
import * as typesMod from "./adapters/types";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const producthuntCfg = (params: Record<string, unknown> = {}) => adapterCfg("producthunt", params);

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

function makeEnrichHtmlWithTopicLabels(
  upvotes: number,
  comments: number,
  topicLabels: string[],
  makers: string[] = ["johndoe"],
): string {
  const topicsHtml = topicLabels
    .map((t) => `<span data-test="topic-link">${t}</span>`)
    .join("");
  const makersHtml = makers.map((m) => `<a href="/@${m}">@${m}</a>`).join("");
  return `<html><body>
    <div>Upvote • ${upvotes} points</div>
    <script>var x = {"commentsCount": ${comments}};</script>
    ${topicsHtml}
    ${makersHtml}
  </body></html>`;
}

describe("producthunt", () => {
  test("ngb contract", () => {
    expect(producthuntAdapter.name).toBe("producthunt");
    expect(typeof producthuntAdapter.fetch).toBe("function");
  });

  test("fetches feed and maps basic items with correct id/source/timestamp/body (no enrich)", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(makePHFeedFixture(), {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      }),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(callUrl).toBe("https://www.producthunt.com/feed");

    expect(items.length).toBe(2);
    expect(items[0].id).toBe("ph:123456");
    expect(items[0].title).toBe("Test Product | Cool new AI tool tagline");
    expect(items[0].url).toContain("test-product-123456");
    expect(items[0].source).toBe("producthunt");
    expect(items[0].timestamp).toBeInstanceOf(Date);
    expect(items[0].body).toContain("Cool new AI tool tagline");
    expect(items[0].body).toContain("by John Doe");
    expect(items[0].body).not.toContain("upvotes");
  });

  test("decodes HTML entities in Atom feed title for source", async () => {
    const entityFeedTitleFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Product &amp; Hunt &#8364;</title>
  <entry>
    <id>tag:www.producthunt.com,2005:Post/555002</id>
    <title>Feed Title Product</title>
    <content>&lt;p&gt;Tagline&lt;/p&gt;</content>
    <link rel="alternate" href="https://www.producthunt.com/posts/feed-title-product-555002" />
    <published>2024-05-24T10:00:00Z</published>
    <author><name>Pat Lee</name></author>
  </entry>
</feed>`;
    mocks.fetchMock.mockResolvedValue(
      new Response(entityFeedTitleFixture, {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      }),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(items.length).toBe(1);
    expect(items[0].source).toBe("Product & Hunt €");
    expect(items[0].source).not.toContain("&amp;");
    expect(items[0].source).not.toContain("&#8364;");
  });

  test("decodes HTML entities in feed entry title", async () => {
    const entityTitleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:www.producthunt.com,2005:Post/555001</id>
    <title>Rock &amp; Roll &#8364;</title>
    <content>&lt;p&gt;Entity tagline&lt;/p&gt;</content>
    <link rel="alternate" href="https://www.producthunt.com/posts/entity-title-555001" />
    <published>2024-05-23T10:00:00Z</published>
    <author><name>Pat Lee</name></author>
  </entry>
</feed>`;
    mocks.fetchMock.mockResolvedValue(
      new Response(entityTitleFeed, {
        status: 200,
        headers: { "content-type": "application/atom+xml" },
      }),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Rock & Roll € | Entity tagline");
    expect(items[0].title).not.toContain("&amp;");
    expect(items[0].title).not.toContain("&#8364;");
  });

  test("strips HTML from feed content body in item body (with and without enrich)", async () => {
    const htmlFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:www.producthunt.com,2005:Post/999001</id>
    <title>HTML Product</title>
    <content type="html"><![CDATA[<p>Hello &amp; <b>world</b></p><p><a href="https://www.producthunt.com/r/html-product">Link</a></p>]]></content>
    <link rel="alternate" href="https://www.producthunt.com/posts/html-product-999001" />
    <published>2024-05-22T08:00:00Z</published>
    <author><name>Pat Lee</name></author>
  </entry>
</feed>`;
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return new Response(htmlFeed, { status: 200 });
      }
      return new Response(makeEnrichHtml(10, 2), { status: 200 });
    });

    const noEnrich = await producthuntAdapter.fetch(producthuntCfg());
    expect(noEnrich[0].body).toContain("Hello & world");
    expect(noEnrich[0].body).not.toMatch(/<[^>]+>/);

    const enriched = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));
    expect(enriched[0].body).toContain("Hello & world");
    expect(enriched[0].body).toContain("10 upvotes");
    expect(enriched[0].body).not.toMatch(/<[^>]+>/);
  });

  test("respects limit param (caps at 50)", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(makePHFeedFixture(), { status: 200 }),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg({ limit: 1 }));

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Test Product | Cool new AI tool tagline");
  });

  test("with enrich=true performs per-product fetches and includes upvotes/comments/topics/makers in body", async () => {
    let callCount = 0;
    mocks.fetchMock.mockImplementation(async (url: string) => {
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

  test("with enrich decodes HTML entities in topic labels", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("producthunt.com/feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      if (u.includes("123456")) {
        return new Response(
          makeEnrichHtmlWithTopicLabels(10, 5, ["AI &amp; ML", "Dev&#39;Tools"]),
          { status: 200 },
        );
      }
      return new Response(makeEnrichHtml(1, 1), { status: 200 });
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items[0].body).toContain("topics: AI & ML, Dev'Tools");
  });

  test("with enrich + min_upvotes filters items below threshold", async () => {
    let call = 0;
    mocks.fetchMock.mockImplementation(async (url: string) => {
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
    expect(items[0].title).toBe("Another Great Product | Second tagline here");
    expect(items[0].body).toContain("300 upvotes");
  });

  test("warns when enrich + min_upvotes filters all items", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      return new Response(makeEnrichHtml(50, 10), { status: 200 });
    });

    const items = await producthuntAdapter.fetch(
      producthuntCfg({ enrich: true, min_upvotes: 100 }),
    );

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "producthunt: min_upvotes (100) filtered all 2 enriched item(s)",
    );
  });

  test("warns when min_upvotes set without enrich (threshold ignored)", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(makePHFeedFixture(), { status: 200 }),
    );

    const items = await producthuntAdapter.fetch(
      producthuntCfg({ min_upvotes: 100 }),
    );

    expect(items.length).toBe(2);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "producthunt: min_upvotes has no effect without enrich: true",
    );
  });

  test("warns and returns [] when feed has no entries", async () => {
    const emptyFeed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    mocks.fetchMock.mockResolvedValue(new Response(emptyFeed, { status: 200 }));

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("producthunt: no entries found in feed");
  });

  test("errorMessage on !ok", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    mocks.fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(
      producthuntAdapter.fetch(producthuntCfg()),
    ).rejects.toThrow(/producthunt: failed to fetch feed: HTTP error 429/);

    const hasStatusObjCall = emSpy.mock.calls.some((call: unknown[]) => {
      const arg = call[0];
      return (
        arg &&
        typeof arg === "object" &&
        arg !== null &&
        "message" in arg &&
        String((arg as { message: string }).message) === "HTTP error 429"
      );
    });
    expect(hasStatusObjCall).toBe(true);
    emSpy.mockRestore();
  });

  test("throws on network reject from feed (wrapped)", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      producthuntAdapter.fetch(producthuntCfg({ limit: 5 })),
    ).rejects.toThrow(/producthunt: error fetching feed: connection refused/);
  });

  test("enrich failures (null) are tolerated and items still returned without extra data", async () => {
    let c = 0;
    mocks.fetchMock.mockImplementation(async (url: string) => {
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
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items.length).toBe(2);
    expect(items[0].body).not.toContain("upvotes");
    const enrichWarns = mocks.warnSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith("producthunt: failed to fetch"),
    );
    expect(enrichWarns).toHaveLength(2);
    expect(enrichWarns[0][0]).toBe(
      "producthunt: failed to fetch https://www.producthunt.com/posts/test-product-123456: HTTP error 404",
    );
  });

  test("warns on enrich network failure and still returns items without enrich data", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return new Response(makePHFeedFixture(), { status: 200 });
      }
      throw new Error("enrich connection refused");
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items.length).toBe(2);
    const enrichWarns = mocks.warnSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith("producthunt: error fetching"),
    );
    expect(enrichWarns).toHaveLength(2);
    expect(enrichWarns[0][0]).toBe(
      "producthunt: error fetching https://www.producthunt.com/posts/test-product-123456: enrich connection refused",
    );
  });
});
