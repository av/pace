import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import adapter from "./arxiv";

const originalFetch = globalThis.fetch;

function makeArxivFixture(title: string, arxivId: string, author = "Test Author", cat = "cs.AI"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/${arxivId}v1</id>
    <title>${title}</title>
    <summary>This is the abstract for ${title} about research.</summary>
    <published>2024-05-20T12:00:00Z</published>
    <updated>2024-05-21T10:00:00Z</updated>
    <author><name>${author}</name></author>
    <arxiv:primary_category term="${cat}" />
    <category term="${cat}" />
    <link href="http://arxiv.org/abs/${arxivId}v1" rel="alternate" type="text/html" />
    <link title="pdf" href="http://arxiv.org/pdf/${arxivId}" type="application/pdf" />
  </entry>
</feed>`;
}

describe("arxiv adapter (DRY quality + test coverage)", () => {
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as any;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("warns and returns empty when no categories and no query configured", async () => {
    const items = await adapter.fetch({ params: {} } as any);
    expect(items).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("arxiv: no categories or query configured"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetches by single category and maps items with correct fields, source, body parts", async () => {
    fetchMock.mockResolvedValue(
      new Response(makeArxivFixture("Attention Is All You Need", "1706.03762", "Ashish Vaswani", "cs.LG"), {
        status: 200,
        headers: { "content-type": "application/xml" },
      }),
    );

    const items = await adapter.fetch({ params: { categories: ["cs.LG"] } } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("arxiv:1706.03762");
    expect(items[0].title).toBe("Attention Is All You Need");
    expect(items[0].source).toBe("arxiv:cs.LG");
    expect(items[0].url).toContain("1706.03762");
    expect(items[0].body).toContain("Authors: Ashish Vaswani");
    expect(items[0].body).toContain("Categories: cs.LG");
    expect(items[0].body).toContain("Abstract:");
    expect(items[0].body).toContain("PDF:");
    expect(items[0].timestamp).toBeInstanceOf(Date);
  });

  test("fetches by keyword query and uses arxiv:search source label", async () => {
    fetchMock.mockResolvedValue(
      new Response(makeArxivFixture("Quantum Paper", "2301.00001", "Alice", "quant-ph"), {
        status: 200,
      }),
    );

    const items = await adapter.fetch({ params: { query: "quantum computing" } } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = String(fetchMock.mock.calls[0][0]);
    expect(callUrl).toContain("all%3Aquantum%20computing");
    expect(items[0].source).toBe("arxiv:search");
    expect(items[0].id).toBe("arxiv:2301.00001");
  });

  test("fetches combined categories + query, deduplicates overlapping ids, applies combined limit scaling", async () => {
    // First call (cat cs.AI) returns idA
    // Second call (query) returns idA (overlap) + idB
    let call = 0;
    fetchMock.mockImplementation(async (url: any) => {
      call++;
      if (call === 1) {
        // cat branch response
        return new Response(makeArxivFixture("Cat Paper", "2501.0001", "CatAuthor", "cs.AI"), { status: 200 });
      }
      // query branch: 2 entries, one overlaps id 2501.0001 for dedup test, one new
      const queryXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry><id>http://arxiv.org/abs/2501.0001v1</id><title>Overlap</title><summary>s</summary><published>2024-01-01</published><author><name>A</name></author><arxiv:primary_category term="cs.AI" /><category term="cs.AI" /><link href="http://arxiv.org/abs/2501.0001v1" /></entry>
  <entry><id>http://arxiv.org/abs/2501.0002v1</id><title>New</title><summary>s</summary><published>2024-01-02</published><author><name>B</name></author><arxiv:primary_category term="cs.AI" /><category term="cs.AI" /><link href="http://arxiv.org/abs/2501.0002v1" /></entry>
</feed>`;
      return new Response(queryXml, { status: 200 });
    });

    const items = await adapter.fetch({ params: { categories: ["cs.AI"], query: "test", limit: 10 } } as any);

    // 1 cat fetch + 1 query fetch = 2 calls (plus internal sleeps not affecting mocks)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // dedup: only 2 unique even though overlap on first id
    expect(items.length).toBe(2);
    const ids = items.map((i) => i.id);
    expect(ids).toContain("arxiv:2501.0001");
    expect(ids).toContain("arxiv:2501.0002");
    // sources mixed
    expect(items.some((i) => i.source === "arxiv:cs.AI")).toBe(true);
    expect(items.some((i) => i.source === "arxiv:search")).toBe(true);
  });

  test("respects limit (per source scaling when multi)", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry><id>http://arxiv.org/abs/1</id><title>P1</title><summary>s</summary><published>2024-01-01</published><author><name>X</name></author><arxiv:primary_category term="cs.AI" /><category term="cs.AI" /><link href="http://arxiv.org/abs/1" /></entry>
  <entry><id>http://arxiv.org/abs/2</id><title>P2</title><summary>s</summary><published>2024-01-01</published><author><name>X</name></author><arxiv:primary_category term="cs.AI" /><category term="cs.AI" /><link href="http://arxiv.org/abs/2" /></entry>
  <entry><id>http://arxiv.org/abs/3</id><title>P3</title><summary>s</summary><published>2024-01-01</published><author><name>X</name></author><arxiv:primary_category term="cs.AI" /><category term="cs.AI" /><link href="http://arxiv.org/abs/3" /></entry>
</feed>`,
        { status: 200 },
      ),
    );

    const items = await adapter.fetch({ params: { categories: ["cs.AI"], limit: 2 } } as any);

    expect(items.length).toBeLessThanOrEqual(2);
  });

  test("throws on HTTP !ok (propagates with adapter prefix)", async () => {
    fetchMock.mockResolvedValue(new Response("rate limit", { status: 429 }));

    await expect(
      adapter.fetch({ params: { categories: ["cs.AI"] } } as any),
    ).rejects.toThrow(/arxiv: failed to fetch query "cat:cs.AI": .*429/);
  });

  test("throws on network/fetch reject (wrapped error)", async () => {
    fetchMock.mockRejectedValue(new Error("DNS fail"));

    await expect(
      adapter.fetch({ params: { query: "foo bar" } } as any),
    ).rejects.toThrow(/arxiv: error fetching query "all:foo bar": DNS fail/);
  });

  test("fetches multiple categories (rate limit respected in impl, results merged+deduped)", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async (url: any) => {
      calls++;
      const u = String(url);
      const cat = u.includes("cs.AI") ? "cs.AI" : "cs.LG";
      return new Response(makeArxivFixture(`${cat} Paper`, `id-${cat}`, "Multi", cat), { status: 200 });
    });

    const items = await adapter.fetch({ params: { categories: ["cs.AI", "cs.LG"], limit: 5 } } as any);

    expect(calls).toBe(2);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.source)).toEqual(expect.arrayContaining(["arxiv:cs.AI", "arxiv:cs.LG"]));
  });

  test("throws on HTTP !ok using errorMessage helper for the cause (mmu error contract coverage for arxiv error path)", async () => {
    fetchMock.mockResolvedValue(new Response("rate limit", { status: 429 }));

    await expect(
      adapter.fetch({ params: { categories: ["cs.AI"] } } as any),
    ).rejects.toThrow(/arxiv: failed to fetch query "cat:cs.AI": HTTP error 429/);
  });
});
