import { describe, expect, test } from "bun:test";
import arxivAdapter, {
  arxivCategorySourceLabel,
  arxivSearchSourceLabel,
} from "./adapters/arxiv";
import { FEED_XML_ACCEPT } from "./adapters/fetch";
import { makeErrorResponse, makeXmlResponse } from "./test/fetch-responses";
import { invalidLimitParams } from "./test/invalid-params";
import {
  fetchMockCallHeaders,
  fetchMockCallUrl,
  useFetchMockSuite,
  expectAdapterFetchError,
} from "./test/adapter-mocks";
import { arxivCfg } from "./test/adapter-cfg";
import {
  arxivDedupOverlapQueryFeedFixture,
  arxivDuplicateCategoriesFeedFixture,
  arxivDoubleEncodedAbstractFeedFixture,
  arxivEntityAbstractFeedFixture,
  arxivFeedFixture,
  arxivHtmlStripFeedFixture,
  arxivLimitMultiEntryFeedFixture,
  arxivLongAbstractFeedFixture,
} from "./test/arxiv-fixtures";

const mocks = useFetchMockSuite();


describe("arxiv source labels", () => {
  test("arxivCategorySourceLabel prefixes category", () => {
    expect(arxivCategorySourceLabel("cs.AI")).toBe("arxiv:cs.AI");
  });

  test("arxivSearchSourceLabel is fixed search token", () => {
    expect(arxivSearchSourceLabel()).toBe("arxiv:search");
  });
});

describe("arxiv", () => {
  test("warns and returns empty when no categories and no query configured", async () => {
    const items = await arxivAdapter.fetch(arxivCfg());
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(expect.stringContaining("arxiv: no categories or query configured"));
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("decodes HTML entities in entry title after stripHtml", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(arxivFeedFixture("Rock &amp; Roll &#8364;", "2401.00002", "Test Author", "cs.AI")),
    );

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] }));

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Rock & Roll €");
  });

  test("decodes HTML entities in entry summary/abstract after stripHtml", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(arxivEntityAbstractFeedFixture()));

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] }));

    expect(items.length).toBe(1);
    expect(items[0].body).toContain("Abstract: Rock & Roll € in the abstract field.");
  });

  test("decodes double-encoded HTML entities in entry summary/abstract", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(arxivDoubleEncodedAbstractFeedFixture()));

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] }));

    expect(items.length).toBe(1);
    expect(items[0].body).toContain("Abstract: Rock & Roll € in the abstract field.");
  });

  test("truncates long abstract in body to 300 characters with ellipsis", async () => {
    const longAbstract = "word ".repeat(120).trim(); // 599 chars — well over 300
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(arxivLongAbstractFeedFixture(longAbstract)));

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] }));

    expect(items.length).toBe(1);
    const abstractPart = items[0].body
      .split(" | ")
      .find((part) => part.startsWith("Abstract: "));
    expect(abstractPart).toBeDefined();
    const abstractText = abstractPart!.slice("Abstract: ".length);
    expect(abstractText.endsWith("...")).toBe(true);
    expect(abstractText.length).toBeLessThanOrEqual(303);
    expect(items[0].body).not.toContain(longAbstract);
  });

  test("title and summary use FEED_BODY_STRIP_OPTIONS (tags, links, entities)", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(arxivHtmlStripFeedFixture()));

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] }));

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Deep & Wide");
    expect(items[0].title).not.toContain("<");
    expect(items[0].body).toContain("Abstract: See paper for A details");
    expect(items[0].body).not.toContain("example.com");
    expect(items[0].body).not.toContain("<");
  });

  test("sends FEED_XML_ACCEPT when fetching category query", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(arxivFeedFixture("Feed Accept Paper", "2401.00001")),
    );

    await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] }));

    const headers = fetchMockCallHeaders(mocks.fetchMock);
    expect(headers.Accept).toBe(FEED_XML_ACCEPT);
  });

  test("deduplicates overlapping primary and secondary categories in body", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(arxivDuplicateCategoriesFeedFixture()));

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] }));

    expect(items.length).toBe(1);
    expect(items[0].body).toContain("Categories: cs.AI, cs.LG");
    expect(items[0].body).not.toContain("cs.AI, cs.AI");
  });

  test("fetches by single category and maps items with correct fields, source, body parts", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(arxivFeedFixture("Attention Is All You Need", "1706.03762", "Ashish Vaswani", "cs.LG")),
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

  test("trims whitespace from configured categories", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(arxivFeedFixture("Trimmed Cat Paper", "2501.0099", "Author", "cs.AI")),
    );

    await arxivAdapter.fetch(arxivCfg({ categories: ["  cs.AI  ", ""] }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(callUrl).toContain("cat%3Acs.AI");
    expect(callUrl).not.toContain("cat%3A%20");
  });

  test("trims whitespace from configured query", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(arxivFeedFixture("Trimmed Query Paper", "2501.0100", "Author", "quant-ph")),
    );

    await arxivAdapter.fetch(arxivCfg({ query: "  quantum computing  " }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(callUrl).toContain("all%3Aquantum%20computing");
    expect(callUrl).not.toContain("%20%20");
  });

  test("whitespace-only query is treated as unconfigured", async () => {
    const items = await arxivAdapter.fetch(arxivCfg({ query: "   " }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(expect.stringContaining("arxiv: no categories or query configured"));
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("fetches by keyword query and uses arxiv:search source label", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(arxivFeedFixture("Quantum Paper", "2301.00001", "Alice", "quant-ph")),
    );

    const items = await arxivAdapter.fetch(arxivCfg({ query: "quantum computing" }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(callUrl).toContain("all%3Aquantum%20computing");
    expect(items[0].source).toBe("arxiv:search");
    expect(items[0].id).toBe("arxiv:2301.00001");
  });

  test("fetches combined categories + query, deduplicates overlapping ids, applies combined limit scaling", async () => {
    let call = 0;
    mocks.fetchMock.mockImplementation(async () => {
      call++;
      if (call === 1) {
        return makeXmlResponse(arxivFeedFixture("Cat Paper", "2501.0001", "CatAuthor", "cs.AI"));
      }
      return makeXmlResponse(arxivDedupOverlapQueryFeedFixture());
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

  test.each(invalidLimitParams(20))(
    "invalid limit (%s) uses default max_results=20",
    async (limit) => {
      mocks.fetchMock.mockResolvedValue(
        makeXmlResponse(arxivFeedFixture("Paper", "2401.00099")),
      );

      await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"], limit }));

      const url = fetchMockCallUrl(mocks.fetchMock);
      expect(url).toContain("max_results=20");
    },
  );

  test("caps limit at 100 in max_results", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(arxivFeedFixture("Paper", "2401.00100")),
    );

    await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"], limit: 500 }));

    const url = fetchMockCallUrl(mocks.fetchMock);
    expect(url).toContain("max_results=100");
  });

  test("floors fractional limit in max_results", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(arxivFeedFixture("Paper", "2401.00007")),
    );

    await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"], limit: 7.9 }));

    const url = fetchMockCallUrl(mocks.fetchMock);
    expect(url).toContain("max_results=7");
  });

  test("respects limit (per source scaling when multi)", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(arxivLimitMultiEntryFeedFixture(3)));

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"], limit: 2 }));

    expect(items.length).toBeLessThanOrEqual(2);
  });

  test("throws on HTTP !ok (propagates with adapter prefix)", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(429));

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
      return makeXmlResponse(arxivFeedFixture(`${cat} Paper`, `id-${cat}`, "Multi", cat));
    });

    const items = await arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI", "cs.LG"], limit: 5 }));

    expect(calls).toBe(2);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.source)).toEqual(expect.arrayContaining(["arxiv:cs.AI", "arxiv:cs.LG"]));
  });

  test("errorMessage on !ok and network", async () => {
    await expectAdapterFetchError(mocks.fetchMock, [
      {
        httpStatus: 429,
        fetch: () => arxivAdapter.fetch(arxivCfg({ categories: ["cs.AI"] })),
        throwMatcher: /arxiv: failed to fetch query "cat:cs.AI":/,
        spy: { message: "HTTP error 429" },
      },
      {
        networkError: new Error("DNS fail"),
        fetch: () => arxivAdapter.fetch(arxivCfg({ query: "foo bar" })),
        throwMatcher: /arxiv: error fetching query "all:foo bar":/,
        spy: "called",
      },
    ]);
  });
});