import { describe, expect, test } from "bun:test";
import wikipediaAdapter, { resolveWikipediaMode, wikipediaSourceLabel } from "./adapters/wikipedia";
import { truncateText } from "./adapters/title";
import { expectAdapterFetchError, fetchMockCallUrl, useFetchMockSuite } from "./test/adapter-mocks";
import { wikiCfg } from "./test/adapter-cfg";
import { makeErrorResponse, makeJsonResponse } from "./test/fetch-responses";
import { invalidLimitParams } from "./test/invalid-params";
import { makeFeaturedResponse, makeMostReadArticle } from "./test/wikipedia-fixtures";

const mocks = useFetchMockSuite();


describe("wikipediaSourceLabel", () => {
  test.each([
    ["most_read", "wikipedia:most_read"],
    ["featured", "wikipedia:featured"],
    ["on_this_day", "wikipedia:on_this_day"],
    ["news", "wikipedia:news"],
  ] as const)("maps %s → %s", (mode, expected) => {
    expect(wikipediaSourceLabel(mode)).toBe(expected);
  });
});

describe("resolveWikipediaMode", () => {
  test.each([
    ["most_read", "most_read"],
    ["featured", "featured"],
    ["on_this_day", "on_this_day"],
    ["news", "news"],
    ["MOST_READ", "most_read"],
    ["on-this-day", "on_this_day"],
    ["  featured  ", "featured"],
    ["mostread", "most_read"],
    ["popular", "most_read"],
    ["tfa", "featured"],
    ["onthisday", "on_this_day"],
    ["otd", "on_this_day"],
    ["current_events", "news"],
    ["currentevents", "news"],
    ["invalid", null],
    ["", null],
    ["   ", null],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(resolveWikipediaMode(input)).toBe(expected);
  });
});

describe("wikipedia", () => {
  test("fetches most_read articles by default", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg());

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "wikipedia:mostread:Test_Article",
      title: "Test Article",
      url: "https://en.wikipedia.org/wiki/Test_Article",
      source: "wikipedia:most_read",
    });
    expect(items[0].body).toContain("50.0k views");
    expect(items[0].body).toContain("A test article");
  });

  test("fetches featured article of the day", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "featured" }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "wikipedia:tfa:Featured_Article",
      title: "Featured: Featured Article",
      url: "https://en.wikipedia.org/wiki/Featured_Article",
      source: "wikipedia:featured",
    });
    expect(items[0].body).toContain("A featured article");
  });

  test("fetches on_this_day events with HTML stripped", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "on_this_day" }));

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("1969: Something important happened.");
    expect(items[0].url).toBe("https://en.wikipedia.org/wiki/Moon_Landing");
    expect(items[0].source).toBe("wikipedia:on_this_day");
    expect(items[0].body).toBe("The Apollo 11 mission");
  });

  test("fetches news items with HTML stripped", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "news" }));

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("A major event occurred today.");
    expect(items[0].url).toBe("https://en.wikipedia.org/wiki/Major_Event");
    expect(items[0].source).toBe("wikipedia:news");
  });

  test.each(invalidLimitParams(20))(
    "invalid limit (%s) uses default slice of 20 for most_read",
    async (limit) => {
      const articles = Array.from({ length: 30 }, (_, i) =>
        makeMostReadArticle({ title: `Article_${i}`, views: 1000 * (30 - i), rank: i + 1 }),
      );
      mocks.fetchMock.mockResolvedValue(
        makeJsonResponse(makeFeaturedResponse({ mostread: { articles } })),
      );

      const items = await wikipediaAdapter.fetch(wikiCfg({ limit }));

      expect(items).toHaveLength(20);
    },
  );

  test("floors fractional limit for most_read", async () => {
    const articles = Array.from({ length: 10 }, (_, i) =>
      makeMostReadArticle({ title: `Article_${i}`, views: 1000 * (10 - i), rank: i + 1 }),
    );
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ mostread: { articles } })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ limit: 7.9 }));

    expect(items).toHaveLength(7);
  });

  test("respects limit parameter for most_read", async () => {
    const articles = Array.from({ length: 10 }, (_, i) =>
      makeMostReadArticle({ title: `Article_${i}`, views: 1000 * (10 - i), rank: i + 1 }),
    );
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ mostread: { articles } })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ limit: 3 }));

    expect(items).toHaveLength(3);
  });

  test("uses language parameter in API URL", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    await wikipediaAdapter.fetch(wikiCfg({ language: "de" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("de.wikipedia.org");
  });

  test("trims whitespace from configured language", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    await wikipediaAdapter.fetch(wikiCfg({ language: "  de  " }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("de.wikipedia.org");
  });

  test("whitespace-only language defaults to en", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    await wikipediaAdapter.fetch(wikiCfg({ language: "   " }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("en.wikipedia.org");
  });

  test("rejects malicious language values and falls back to en", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    await wikipediaAdapter.fetch(wikiCfg({ language: "evil.com/hack#" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("en.wikipedia.org");
    expect(calledUrl).not.toContain("evil");
  });

  test("defaults to most_read for invalid mode", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "invalid" }));

    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("wikipedia:most_read");
  });

  test("merges comma-separated modes from one featured feed", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "featured,news" }));

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.source)).toEqual(["wikipedia:featured", "wikipedia:news"]);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  test("trims whitespace from comma-separated mode string", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(
      wikiCfg({ mode: "  featured ,  news  " }),
    );

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.source)).toEqual(["wikipedia:featured", "wikipedia:news"]);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  test("whitespace-only mode string falls back to most_read", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "   " }));

    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("wikipedia:most_read");
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  test("merges modes array param from one featured feed", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(
      wikiCfg({ modes: [" featured ", "news", ""] }),
    );

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.source)).toEqual(["wikipedia:featured", "wikipedia:news"]);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  test("blank-only modes array falls back to most_read", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse()),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ modes: ["", "  "] }));

    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("wikipedia:most_read");
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  test("applies global limit after merging multiple modes (not per-mode)", async () => {
    const articles = Array.from({ length: 8 }, (_, i) =>
      makeMostReadArticle({
        title: `MostRead_${i}`,
        views: 10_000 - i,
        rank: i + 1,
        content_urls: {
          desktop: { page: `https://en.wikipedia.org/wiki/MostRead_${i}` },
        },
      }),
    );
    const onThisDayEvents = Array.from({ length: 6 }, (_, i) => ({
      text: `Event ${i} happened.`,
      year: 1900 + i,
      pages: [
        {
          title: `OTD_${i}`,
          content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/OTD_${i}` } },
        },
      ],
    }));
    const newsItems = Array.from({ length: 5 }, (_, i) => ({
      story: `News story ${i}.`,
      links: [
        {
          title: `News_${i}`,
          content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/News_${i}` } },
        },
      ],
    }));

    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(
          makeFeaturedResponse({
            mostread: { articles },
            onthisday: onThisDayEvents,
            news: newsItems,
          }),
        ),
    );

    const items = await wikipediaAdapter.fetch(
      wikiCfg({ mode: "most_read,on_this_day,news", limit: 3 }),
    );

    expect(items).toHaveLength(3);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  test("dedupes by URL when the same article appears in multiple modes", async () => {
    const sharedPage = "https://en.wikipedia.org/wiki/Test_Article";
    const secondPage = "https://en.wikipedia.org/wiki/Second_Article";
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(
        makeFeaturedResponse({
          mostread: {
            articles: [
              makeMostReadArticle(),
              makeMostReadArticle({
                title: "Second_Article",
                views: 30000,
                rank: 2,
                content_urls: { desktop: { page: secondPage } },
              }),
            ],
          },
          tfa: {
            title: "Test_Article",
            extract: "Also featured today.",
            description: "Featured blurb",
            content_urls: { desktop: { page: sharedPage } },
          },
        }),
      ),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "most_read,featured", limit: 10 }));

    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.url === sharedPage)).toHaveLength(1);
    expect(items[0].source).toBe("wikipedia:most_read");
  });

  test("throws on HTTP error with adapter prefix", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(404));

    await expect(wikipediaAdapter.fetch(wikiCfg())).rejects.toThrow("wikipedia:");
  });

  test("throws on network error with adapter prefix", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("DNS resolution failed"));

    await expect(wikipediaAdapter.fetch(wikiCfg())).rejects.toThrow("wikipedia:");
  });

  test("warns and returns empty for featured when tfa is missing (single mode)", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ tfa: undefined })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "featured" }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "wikipedia: featured feed has no article of the day (en)",
    );
  });

  test("warns on malformed mostread.articles shape without duplicate missing-section warn in merge mode", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(
        makeFeaturedResponse({
          mostread: { articles: "not-an-array" as unknown as never },
          news: [
            {
              story: "A major event occurred today.",
              links: [
                {
                  title: "Major_Event",
                  content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Major_Event" } },
                },
              ],
            },
          ],
        }),
      ),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "most_read,news" }));

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("wikipedia:news");
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      'wikipedia: expected array field "articles" for featured feed most_read (got string), treating as empty',
    );
    expect(mocks.warnSpy).not.toHaveBeenCalledWith(
      "wikipedia: featured feed has no most_read articles (en)",
    );
  });

  test("warns and returns empty for most_read when mostread section is missing (single mode)", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ mostread: undefined })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "most_read" }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "wikipedia: featured feed has no most_read articles (en)",
    );
  });

  test("does not warn on empty most_read when merged with other modes", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ mostread: undefined })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "most_read,news" }));

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("wikipedia:news");
    expect(mocks.warnSpy).not.toHaveBeenCalled();
  });

  test("truncates long extract in most_read body when description is missing", async () => {
    const longExtract = "word ".repeat(80).trim(); // 399 chars
    const articles = [
      makeMostReadArticle({ description: undefined, extract: longExtract }),
    ];
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ mostread: { articles } })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg());

    const extractPart = items[0].body.split(" | ").find((part) => !part.endsWith(" views"));
    expect(extractPart).toBe(
      truncateText(longExtract, 150, { ellipsis: "...", inclusive: false, trim: false }),
    );
    expect(extractPart!.length).toBeLessThanOrEqual(153);
  });

  test("truncates long extract in featured body when description is missing", async () => {
    const longExtract = "x".repeat(250);
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(
          makeFeaturedResponse({
            tfa: {
              title: "Long_Featured",
              extract: longExtract,
              content_urls: {
                desktop: { page: "https://en.wikipedia.org/wiki/Long_Featured" },
              },
            },
          }),
        ),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "featured" }));

    expect(items[0].body).toBe(`${"x".repeat(200)}...`);
    expect(items[0].body.length).toBe(203);
  });

  test("formats view counts correctly", async () => {
    const articles = [
      makeMostReadArticle({ title: "Million", views: 1_500_000 }),
      makeMostReadArticle({ title: "Thousand", views: 42_500 }),
      makeMostReadArticle({ title: "Small", views: 500 }),
    ];
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ mostread: { articles } })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg());

    expect(items[0].body).toContain("1.5m views");
    expect(items[1].body).toContain("42.5k views");
    expect(items[2].body).toContain("500 views");
  });

  test("decodes HTML entities in on_this_day and news titles", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(
          makeFeaturedResponse({
            onthisday: [
              {
                text: "Rock &amp; Roll &#8364; <b>happened</b>.",
                year: 2000,
                pages: [
                  {
                    title: "Event_Page",
                    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Event_Page" } },
                  },
                ],
              },
            ],
            news: [
              {
                story: "News &amp; updates &#8364; <b>today</b>.",
                links: [
                  {
                    title: "News_Page",
                    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/News_Page" } },
                  },
                ],
              },
            ],
          }),
        ),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg({ mode: "on_this_day,news" }));
    const otd = items.find((i) => i.source === "wikipedia:on_this_day");
    const news = items.find((i) => i.source === "wikipedia:news");

    expect(otd?.title).toBe("2000: Rock & Roll € happened.");
    expect(otd?.title).not.toContain("&amp;");
    expect(otd?.title).not.toContain("&#8364;");

    expect(news?.title).toBe("News & updates € today.");
    expect(news?.title).not.toContain("&amp;");
    expect(news?.title).not.toContain("&#8364;");
  });

  test("decodes HTML entities in article titles from API", async () => {
    const articles = [
      makeMostReadArticle({ title: "Rock_&amp;_Roll_&#8364;" }),
    ];
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ mostread: { articles } })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg());

    expect(items[0].title).toBe("Rock & Roll €");
    expect(items[0].title).not.toContain("&amp;");
    expect(items[0].title).not.toContain("&#8364;");
  });

  test("replaces underscores with spaces in titles", async () => {
    const articles = [makeMostReadArticle({ title: "United_States_of_America" })];
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeFeaturedResponse({ mostread: { articles } })),
    );

    const items = await wikipediaAdapter.fetch(wikiCfg());

    expect(items[0].title).toBe("United States of America");
  });

  test("errorMessage on !ok and network", async () => {
    await expectAdapterFetchError(
      mocks.fetchMock,
      [
        {
          httpStatus: 404,
          fetch: () => wikipediaAdapter.fetch(wikiCfg()),
          throwMatcher: "wikipedia:",
        },
        {
          networkError: new Error("DNS resolution failed"),
          fetch: () => wikipediaAdapter.fetch(wikiCfg()),
          throwMatcher: "wikipedia:",
        },
      ],
      { clearBetweenCases: false, spy: [{ message: "HTTP error 404" }, { times: 2 }] },
    );
  });
});