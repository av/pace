import { describe, test, expect } from "bun:test";
import producthuntAdapter from "./adapters/producthunt";
import { makeErrorResponse, makeTextResponse, makeXmlResponse } from "./test/fetch-responses";
import { invalidLimitParams, invalidMinScoreParams } from "./test/invalid-params";
import { expectAdapterFetchError, fetchMockCallUrl, useFetchMockSuite } from "./test/adapter-mocks";
import { spyMockCallsContaining, spyMockCallsStartingWith } from "./test/console-spy";
import { producthuntCfg } from "./test/adapter-cfg";
import {
  productHuntEmptyFeedFixture,
  productHuntEnrichHtml,
  productHuntEntityEntryTitleFixture,
  productHuntEntityFeedTitleFixture,
  productHuntFeedFixture,
  productHuntHtmlContentFeedFixture,
  productHuntSyntheticEntries,
} from "./test/producthunt-fixtures";

const mocks = useFetchMockSuite();


describe("producthunt", () => {
  test("fetches feed and maps basic items with correct id/source/timestamp/body (no enrich)", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(productHuntFeedFixture()));

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMockCallUrl(mocks.fetchMock);
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
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(productHuntEntityFeedTitleFixture()));

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(items.length).toBe(1);
    expect(items[0].source).toBe("Product & Hunt €");
    expect(items[0].source).not.toContain("&amp;");
    expect(items[0].source).not.toContain("&#8364;");
  });

  test("decodes HTML entities in feed entry title", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(productHuntEntityEntryTitleFixture()));

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Rock & Roll € | Entity tagline");
    expect(items[0].title).not.toContain("&amp;");
    expect(items[0].title).not.toContain("&#8364;");
  });

  test("strips HTML from feed content body in item body (with and without enrich)", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return makeXmlResponse(productHuntHtmlContentFeedFixture());
      }
      return makeTextResponse(productHuntEnrichHtml(10, 2));
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
      makeXmlResponse(productHuntFeedFixture()),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg({ limit: 1 }));

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Test Product | Cool new AI tool tagline");
  });

  test.each(invalidLimitParams(20))(
    "invalid limit (%s) uses default slice of 20 when limit param set",
    async (limit) => {
      mocks.fetchMock.mockResolvedValue(
        makeXmlResponse(
          productHuntFeedFixture({
            entries: productHuntSyntheticEntries(25, {
              idBase: 100000,
              titlePrefix: "Product",
              taglinePrefix: "Tagline",
              slugPrefix: "product",
            }),
          }),
        ),
      );

      const items = await producthuntAdapter.fetch(producthuntCfg({ limit }));

      expect(items).toHaveLength(20);
      expect(items[0].title).toBe("Product 0 | Tagline 0");
    },
  );

  test("caps limit at 50", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(
        productHuntFeedFixture({
          entries: productHuntSyntheticEntries(60, {
            idBase: 200000,
            titlePrefix: "Cap",
            taglinePrefix: "T",
            slugPrefix: "cap",
          }),
        }),
      ),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg({ limit: 500 }));

    expect(items).toHaveLength(50);
  });

  test("floors fractional limit", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(
        productHuntFeedFixture({
          entries: productHuntSyntheticEntries(10, {
            idBase: 300000,
            titlePrefix: "Floor",
            taglinePrefix: "T",
            slugPrefix: "floor",
          }),
        }),
      ),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg({ limit: 7.9 }));

    expect(items).toHaveLength(7);
  });

  test("without limit param returns all feed entries", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse(productHuntFeedFixture()),
    );

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(items).toHaveLength(2);
  });

  test("with enrich=true performs per-product fetches and includes upvotes/comments/topics/makers in body", async () => {
    let callCount = 0;
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      callCount++;
      if (u.includes("producthunt.com/feed")) {
        return makeXmlResponse(productHuntFeedFixture());
      }
      // enrich calls for the two product pages
      if (u.includes("123456")) {
        return makeTextResponse(productHuntEnrichHtml(215, 67, ["ai", "devtools"], ["johndoe"]));
      }
      return makeTextResponse(productHuntEnrichHtml(42, 12, ["design"], ["janesmith"]));
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

  test("with enrich prefers embedded makers JSON over page-wide /@handle anchors", async () => {
    const html = `<html><body>
      <div>Upvote • 10 points</div>
      <nav><a href="/@commenter_guy">@commenter_guy</a></nav>
      <script>var s = {"makers":[{"id":"1","username":"realmaker"}],"commentsCount": 3};</script>
      <a href="/@another_commenter">@another_commenter</a>
    </body></html>`;
    mocks.fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("producthunt.com/feed")
        ? makeXmlResponse(productHuntFeedFixture())
        : makeTextResponse(html));

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items[0].body).toContain("by @realmaker");
    expect(items[0].body).not.toContain("commenter");
  });

  test("with enrich an empty makers JSON block suppresses the anchor fallback (commenters are not makers)", async () => {
    const html = `<html><body>
      <div>Upvote • 10 points</div>
      <script>var s = {"makers":[],"commentsCount": 3};</script>
      <a href="/@some_commenter">@some_commenter</a>
    </body></html>`;
    mocks.fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("producthunt.com/feed")
        ? makeXmlResponse(productHuntFeedFixture())
        : makeTextResponse(html));

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items[0].body).not.toContain("by @");
  });

  test("with enrich decodes HTML entities in topic labels", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("producthunt.com/feed")) {
        return makeXmlResponse(productHuntFeedFixture());
      }
      if (u.includes("123456")) {
        return makeTextResponse(productHuntEnrichHtml(10, 5, ["AI &amp; ML", "Dev&#39;Tools"], ["johndoe"], true));
      }
      return makeTextResponse(productHuntEnrichHtml(1, 1));
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
        return makeXmlResponse(productHuntFeedFixture());
      }
      if (u.includes("123456")) {
        return makeTextResponse(productHuntEnrichHtml(50, 10));
      }
      return makeTextResponse(productHuntEnrichHtml(300, 99));
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
        return makeXmlResponse(productHuntFeedFixture());
      }
      return makeTextResponse(productHuntEnrichHtml(50, 10));
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
      makeXmlResponse(productHuntFeedFixture()),
    );

    const items = await producthuntAdapter.fetch(
      producthuntCfg({ min_upvotes: 100 }),
    );

    expect(items.length).toBe(2);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "producthunt: min_upvotes has no effect without enrich: true",
    );
  });

  test.each(invalidMinScoreParams(100))(
    "invalid min_upvotes (%s) treated as 0 without misconfig warn",
    async (min_upvotes) => {
      mocks.fetchMock.mockResolvedValue(
        makeXmlResponse(productHuntFeedFixture()),
      );

      const items = await producthuntAdapter.fetch(
        producthuntCfg({ min_upvotes }),
      );

      expect(items.length).toBe(2);
      expect(mocks.warnSpy).not.toHaveBeenCalled();
    },
  );

  test("enrich + invalid min_upvotes does not filter items", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return makeXmlResponse(productHuntFeedFixture());
      }
      return makeTextResponse(productHuntEnrichHtml(50, 10));
    });

    const items = await producthuntAdapter.fetch(
      producthuntCfg({ enrich: true, min_upvotes: NaN }),
    );

    expect(items.length).toBe(2);
    expect(spyMockCallsContaining(mocks.warnSpy, "min_upvotes")).toHaveLength(0);
  });

  test("warns and returns [] when feed has no entries", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(productHuntEmptyFeedFixture()));

    const items = await producthuntAdapter.fetch(producthuntCfg());

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("producthunt: no entries found in feed");
  });

  test("errorMessage on !ok", async () => {
    await expectAdapterFetchError(
      mocks.fetchMock,
      {
        httpStatus: 429,
        fetch: () => producthuntAdapter.fetch(producthuntCfg()),
        throwMatcher: /producthunt: failed to fetch feed: HTTP error 429/,
      },
    );
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
        return makeXmlResponse(productHuntFeedFixture());
      }
      return makeTextResponse("<html>no data</html>"); // !ok? no, but no matches -> null
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
        return makeXmlResponse(productHuntFeedFixture());
      }
      return makeErrorResponse(404);
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items.length).toBe(2);
    expect(items[0].body).not.toContain("upvotes");
    const enrichWarns = spyMockCallsStartingWith(mocks.warnSpy, "producthunt: failed to fetch");
    expect(enrichWarns).toHaveLength(2);
    expect(enrichWarns[0][0]).toBe(
      "producthunt: failed to fetch https://www.producthunt.com/posts/test-product-123456: HTTP error 404",
    );
  });

  test("warns on enrich network failure and still returns items without enrich data", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("feed")) {
        return makeXmlResponse(productHuntFeedFixture());
      }
      throw new Error("enrich connection refused");
    });

    const items = await producthuntAdapter.fetch(producthuntCfg({ enrich: true }));

    expect(items.length).toBe(2);
    const enrichWarns = spyMockCallsStartingWith(mocks.warnSpy, "producthunt: error fetching");
    expect(enrichWarns).toHaveLength(2);
    expect(enrichWarns[0][0]).toBe(
      "producthunt: error fetching https://www.producthunt.com/posts/test-product-123456: enrich connection refused",
    );
  });
});
