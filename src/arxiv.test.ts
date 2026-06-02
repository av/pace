import { describe, expect, spyOn, test } from "bun:test";
import arxivAdapter from "./adapters/arxiv";
import * as typesMod from "./adapters/types";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const arxivCfg = (params: Record<string, unknown> = {}) => adapterCfg("arxiv", params);

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

describe("arxiv", () => {
  test("ngb contract", () => {
    expect(arxivAdapter.name).toBe("arxiv");
    expect(typeof arxivAdapter.fetch).toBe("function");
  });

  test("warns and returns empty when no categories and no query configured", async () => {
    const items = await arxivAdapter.fetch(arxivCfg());
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(expect.stringContaining("arxiv: no categories or query configured"));
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("fetches by single category and maps items with correct fields, source, body parts", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(makeArxivFixture("Attention Is All You Need", "1706.03762", "Ashish Vaswani", "cs.LG"), {
        status: 200,
        headers: { "content-type": "application/xml" },
      }),
    );

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.LG"] }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
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
    mocks.fetchMock.mockResolvedValue(
      new Response(makeArxivFixture("Quantum Paper", "2301.00001", "Alice", "quant-ph"), {
        status: 200,
      }),
    );

    const items = await arxivAdapter.fetch(arxivCfg({ query: "quantum computing" }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(callUrl).toContain("all%3Aquantum%20computing");
    expect(items[0].source).toBe("arxiv:search");
    expect(items[0].id).toBe("arxiv:2301.00001");
  });

  test("fetches combined categories + query, deduplicates overlapping ids, applies combined limit scaling", async () => {
    let call = 0;
    mocks.fetchMock.mockImplementation(async () => {
      call++;
      if (call === 1) {
        return new Response(makeArxivFixture("Cat Paper", "2501.0001", "CatAuthor", "cs.AI"), { status: 200 });
      }
      const queryXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry><id>http://arxiv.org/abs/2501.0001v1</id><title>Overlap</title><summary>s</summary><published>2024-01-01</published><author><name>A</name></author><arxiv:primary_category term="cs.AI" /><category term="cs.AI" /><link href="http://arxiv.org/abs/2501.0001v1" /></entry>
  <entry><id>http://arxiv.org/abs/2501.0002v1</id><title>New</title><summary>s</summary><published>2024-01-02</published><author><name>B</name></author><arxiv:primary_category term="cs.AI" /><category term="cs.AI" /><link href="http://arxiv.org/abs/2501.0002v1" /></entry>
</feed>`;
      return new Response(queryXml, { status: 200 });
    });

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"], query: "test", limit: 10 }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    expect(items.length).toBe(2);
    const ids = items.map((i) => i.id);
    expect(ids).toContain("arxiv:2501.0001");
    expect(ids).toContain("arxiv:2501.0002");
    expect(items.some((i) => i.source === "arxiv:cs.AI")).toBe(true);
    expect(items.some((i) => i.source === "arxiv:search")).toBe(true);
  });

  test("respects limit (per source scaling when multi)", async () => {
    mocks.fetchMock.mockResolvedValue(
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

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"], limit: 2 }));

    expect(items.length).toBeLessThanOrEqual(2);
  });

  test("throws on HTTP !ok (propagates with adapter prefix)", async () => {
    mocks.fetchMock.mockResolvedValue(new Response("rate limit", { status: 429 }));

    await expect(
      arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] })),
    ).rejects.toThrow(/arxiv: failed to fetch query "cat:cs.AI": HTTP error 429/);
  });

  test("throws on network/fetch reject (wrapped error)", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("DNS fail"));

    await expect(
      arxivAdapter.fetch(arxivCfg({ query: "foo bar" })),
    ).rejects.toThrow(/arxiv: error fetching query "all:foo bar": DNS fail/);
  });

  test("fetches multiple categories (rate limit respected in impl, results merged+deduped)", async () => {
    let calls = 0;
    mocks.fetchMock.mockImplementation(async (url) => {
      calls++;
      const u = String(url);
      const cat = u.includes("cs.AI") ? "cs.AI" : "cs.LG";
      return new Response(makeArxivFixture(`${cat} Paper`, `id-${cat}`, "Multi", cat), { status: 200 });
    });

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI", "cs.LG"], limit: 5 }));

    expect(calls).toBe(2);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.source)).toEqual(expect.arrayContaining(["arxiv:cs.AI", "arxiv:cs.LG"]));
  });

  test("errorMessage on !ok and network", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      mocks.fetchMock.mockResolvedValue(new Response("rate limit", { status: 429 }));
      await expect(
        arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] })),
      ).rejects.toThrow(/arxiv: failed to fetch query "cat:cs.AI":/);
      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 429" });

      emSpy.mockClear();

      mocks.fetchMock.mockRejectedValue(new Error("DNS fail"));
      await expect(
        arxivAdapter.fetch(arxivCfg({ query: "foo bar" })),
      ).rejects.toThrow(/arxiv: error fetching query "all:foo bar":/);
      expect(emSpy).toHaveBeenCalled();
    } finally {
      emSpy.mockRestore();
    }
  });
});