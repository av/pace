import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import wikipediaAdapter from "./adapters/wikipedia";
import * as typesMod from "./adapters/types";

const originalFetch = globalThis.fetch;

describe("wikipedia", () => {
  let fetchMock: ReturnType<typeof mock>;

  test("ngb contract", () => {
    expect(wikipediaAdapter.name).toBe("wikipedia");
    expect(typeof wikipediaAdapter.fetch).toBe("function");
  });

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  function makeMostReadArticle(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      title: "Test_Article",
      extract: "This is a test article about something interesting.",
      description: "A test article",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Test_Article" } },
      views: 50000,
      rank: 1,
      ...overrides,
    };
  }

  function makeFeaturedResponse(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      tfa: {
        title: "Featured_Article",
        extract: "Today's featured article is about featured things.",
        description: "A featured article",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Featured_Article" } },
      },
      mostread: {
        articles: [
          makeMostReadArticle(),
          makeMostReadArticle({ title: "Second_Article", views: 30000, rank: 2 }),
        ],
      },
      onthisday: [
        {
          text: "Something <b>important</b> happened.",
          year: 1969,
          pages: [
            {
              title: "Moon_Landing",
              description: "The Apollo 11 mission",
              content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Moon_Landing" } },
            },
          ],
        },
      ],
      news: [
        {
          story: "A <b>major event</b> occurred today.",
          links: [
            {
              title: "Major_Event",
              description: "Details about the event",
              content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Major_Event" } },
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  test("fetches most_read articles by default", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse()), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: {} });

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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse()), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: { mode: "featured" } });

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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse()), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: { mode: "on_this_day" } });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("1969: Something important happened.");
    expect(items[0].url).toBe("https://en.wikipedia.org/wiki/Moon_Landing");
    expect(items[0].source).toBe("wikipedia:on_this_day");
    expect(items[0].body).toBe("The Apollo 11 mission");
  });

  test("fetches news items with HTML stripped", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse()), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: { mode: "news" } });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("A major event occurred today.");
    expect(items[0].url).toBe("https://en.wikipedia.org/wiki/Major_Event");
    expect(items[0].source).toBe("wikipedia:news");
  });

  test("respects limit parameter for most_read", async () => {
    const articles = Array.from({ length: 10 }, (_, i) =>
      makeMostReadArticle({ title: `Article_${i}`, views: 1000 * (10 - i), rank: i + 1 }),
    );
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse({ mostread: { articles } })), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: { limit: 3 } });

    expect(items).toHaveLength(3);
  });

  test("uses language parameter in API URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse()), { status: 200 }),
    );

    await wikipediaAdapter.fetch({ type: "wikipedia", params: { language: "de" } });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("de.wikipedia.org");
  });

  test("rejects malicious language values and falls back to en", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse()), { status: 200 }),
    );

    await wikipediaAdapter.fetch({ type: "wikipedia", params: { language: "evil.com/hack#" } });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("en.wikipedia.org");
    expect(calledUrl).not.toContain("evil");
  });

  test("defaults to most_read for invalid mode", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse()), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: { mode: "invalid" } });

    expect(items).toHaveLength(2);
    expect(items[0].source).toBe("wikipedia:most_read");
  });

  test("merges comma-separated modes from one featured feed", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse()), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({
      type: "wikipedia",
      params: { mode: "featured,news" },
    });

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.source)).toEqual(["wikipedia:featured", "wikipedia:news"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("dedupes by URL when the same article appears in multiple modes", async () => {
    const sharedPage = "https://en.wikipedia.org/wiki/Test_Article";
    const secondPage = "https://en.wikipedia.org/wiki/Second_Article";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify(
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
        { status: 200 },
      ),
    );

    const items = await wikipediaAdapter.fetch({
      type: "wikipedia",
      params: { mode: "most_read,featured", limit: 10 },
    });

    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.url === sharedPage)).toHaveLength(1);
    expect(items[0].source).toBe("wikipedia:most_read");
  });

  test("throws on HTTP error with adapter prefix", async () => {
    fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));

    await expect(
      wikipediaAdapter.fetch({ type: "wikipedia", params: {} }),
    ).rejects.toThrow("wikipedia:");
  });

  test("throws on network error with adapter prefix", async () => {
    fetchMock.mockRejectedValue(new Error("DNS resolution failed"));

    await expect(
      wikipediaAdapter.fetch({ type: "wikipedia", params: {} }),
    ).rejects.toThrow("wikipedia:");
  });

  test("returns empty for featured when tfa is missing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse({ tfa: undefined })), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: { mode: "featured" } });

    expect(items).toEqual([]);
  });

  test("returns empty for most_read when mostread section is missing", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse({ mostread: undefined })), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: { mode: "most_read" } });

    expect(items).toEqual([]);
  });

  test("formats view counts correctly", async () => {
    const articles = [
      makeMostReadArticle({ title: "Million", views: 1_500_000 }),
      makeMostReadArticle({ title: "Thousand", views: 42_500 }),
      makeMostReadArticle({ title: "Small", views: 500 }),
    ];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse({ mostread: { articles } })), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: {} });

    expect(items[0].body).toContain("1.5m views");
    expect(items[1].body).toContain("42.5k views");
    expect(items[2].body).toContain("500 views");
  });

  test("replaces underscores with spaces in titles", async () => {
    const articles = [makeMostReadArticle({ title: "United_States_of_America" })];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeFeaturedResponse({ mostread: { articles } })), { status: 200 }),
    );

    const items = await wikipediaAdapter.fetch({ type: "wikipedia", params: {} });

    expect(items[0].title).toBe("United States of America");
  });

  test("errorMessage on !ok and network", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));
      await expect(
        wikipediaAdapter.fetch({ type: "wikipedia", params: {} }),
      ).rejects.toThrow("wikipedia:");
      expect(emSpy).toHaveBeenCalledWith({ message: "404" });

      fetchMock.mockRejectedValue(new Error("DNS resolution failed"));
      await expect(
        wikipediaAdapter.fetch({ type: "wikipedia", params: {} }),
      ).rejects.toThrow("wikipedia:");
      expect(emSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      emSpy.mockRestore();
    }
  });
});