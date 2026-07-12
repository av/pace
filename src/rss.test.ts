import { beforeEach, describe, expect, test } from "bun:test";
import rssAdapter from "./adapters/rss";
import { expectAdapterFetchError, useFetchMockSuite } from "./test/adapter-mocks";
import { rssCfg } from "./test/adapter-cfg";
import { makeXmlResponse } from "./test/fetch-responses";
import {
  atomEntityTitlesFeedFixture,
  rssDefaultFetchImpl,
  rssEntityTitlesFeedFixture,
  rssHtmlBodyFeedFixture,
  rssNoChannelTitleFeedFixture,
  rssOverlapFeedFixture,
  rssTwoItemFeedFixture,
} from "./test/rss-fixtures";

const mocks = useFetchMockSuite();

describe("rss", () => {
  beforeEach(() => {
    mocks.fetchMock.mockImplementation(rssDefaultFetchImpl);
  });

  test("returns [] and no fetch when no urls configured", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: [] }));
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalledWith("rss: no urls configured");
  });

  test("optional limit caps per-feed mapping before global finalize", async () => {
    const items = await rssAdapter.fetch(
      rssCfg({ urls: ["https://ex.com/rss"], limit: 1 }),
    );
    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Item One");
  });

  test("fetches single RSS 2.0 feed and maps fields correctly (string titles/links)", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/rss"] }));
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({
      title: "Item Two",
      url: "https://example.com/two",
      source: "Example RSS Feed",
      body: "Second item body",
    });
    expect(items[0].id).toContain("rss:https://example.com/two");
    expect(items[0].timestamp).toBeInstanceOf(Date);
    expect(items[0].timestamp.getFullYear()).toBe(2024);
  });

  test("fetches and parses Atom feed (uses feed.entry + link[@href] + summary)", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/atom"] }));
    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({
      title: "Atom Item",
      url: "https://example.com/atom1",
      source: "Example Atom Feed",
      body: "Atom body content here",
    });
  });

  test("resolves relative entry links against the feed URL", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("feed.atom")) {
        return makeXmlResponse(`<?xml version="1.0"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <title>Relative Atom</title>
            <entry><title>Atom entry</title><link href="../posts/atom" /></entry>
          </feed>`);
      }
      return makeXmlResponse(`<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Relative RSS</title>
          <item><title>RSS entry</title><link>/posts/rss</link></item>
        </channel></rss>`);
    });

    const items = await rssAdapter.fetch(rssCfg({
      urls: [
        "https://news.example.com/feeds/releases.xml",
        "https://news.example.com/feeds/feed.atom",
      ],
    }));

    expect(items.map((item) => item.url).sort()).toEqual([
      "https://news.example.com/posts/atom",
      "https://news.example.com/posts/rss",
    ]);
    expect(items.map((item) => item.id).sort()).toEqual([
      "rss:https://news.example.com/posts/atom",
      "rss:https://news.example.com/posts/rss",
    ]);
  });

  test("decodes numeric XML entities in RSS and Atom links", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("feed.atom")) {
        return makeXmlResponse(`<?xml version="1.0"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <title>Entity Atom</title>
            <entry><title>Atom entry</title>
              <link href="https://example.com/atom?source=atom&#x26;medium=feed" />
            </entry>
          </feed>`);
      }
      return makeXmlResponse(`<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Entity RSS</title>
          <item><title>RSS entry</title>
            <link>https://example.com/rss?source=rss&#038;medium=feed</link>
          </item>
        </channel></rss>`);
    });

    const items = await rssAdapter.fetch(rssCfg({
      urls: ["https://feeds.example.com/feed.rss", "https://feeds.example.com/feed.atom"],
    }));

    expect(items.map(({ url }) => url).sort()).toEqual([
      "https://example.com/atom?source=atom&medium=feed",
      "https://example.com/rss?source=rss&medium=feed",
    ]);
    expect(items.map(({ id }) => id).sort()).toEqual([
      "rss:https://example.com/atom?source=atom&medium=feed",
      "rss:https://example.com/rss?source=rss&medium=feed",
    ]);
  });

  test("merges multiple urls (RSS + Atom)", async () => {
    const items = await rssAdapter.fetch(
      rssCfg({ urls: ["https://ex.com/rss", "https://ex.com/atom"] }),
    );
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    expect(items.length).toBe(3);
  });

  test("dedupes the same item link across multiple feeds", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("overlap")) {
        return makeXmlResponse(rssOverlapFeedFixture());
      }
      return makeXmlResponse(rssTwoItemFeedFixture());
    });

    const items = await rssAdapter.fetch(
      rssCfg({ urls: ["https://ex.com/rss", "https://ex.com/overlap"] }),
    );
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    expect(items.length).toBe(2);
    expect(items.filter((i) => i.url === "https://example.com/one")).toHaveLength(1);
    expect(items[0].title).toBe("Item Two");
    expect(items[1].title).toBe("Item One");
    expect(items[1].body).toBe("First item body text");
  });

  test("decodes HTML entities in RSS/Atom feed and entry titles", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("atom-entity")) {
        return makeXmlResponse(atomEntityTitlesFeedFixture());
      }
      if (url.includes("entity")) {
        return makeXmlResponse(rssEntityTitlesFeedFixture());
      }
      return rssDefaultFetchImpl(input);
    });

    const rssItems = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/entity"] }));
    expect(rssItems[0].source).toBe("Chan & Co €");
    expect(rssItems[0].title).toBe("Rock & Roll €");

    const atomItems = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/atom-entity"] }));
    expect(atomItems[0].source).toBe("Atom & Feed €");
    expect(atomItems[0].title).toBe("Atom & Entry €");
  });

  test("strips HTML from description and content:encoded bodies", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(rssHtmlBodyFeedFixture()));

    const items = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/htmlbody"] }));
    expect(items.length).toBe(2);
    expect(items[0].body).toBe("Line A one");
    expect(items[1].body).toBe("Hello & world");
  });

  test("handles link array form in parse (prefers alternate href)", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/mixed"] }));
    expect(items.length).toBe(1);
    expect(items[0].url).toBe("https://example.com/real");
    expect(items[0].body).toBe("body for link array");
  });

  test("throws wrapped error on network/reject with 'rss: error fetching ...' prefix", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("connection refused"));
    await expect(rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/neterr"] }))).rejects.toThrow(
      /rss: error fetching https:\/\/ex.com\/neterr: connection refused/,
    );
  });

  test("throws on non-ok response with 'rss: failed to fetch ...' prefix", async () => {
    await expect(rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/badstatus"] }))).rejects.toThrow(
      /rss: failed to fetch https:\/\/ex.com\/badstatus: HTTP error 404/,
    );
  });

  test("throws on XML parse failure with 'rss: error parsing xml from ...' prefix", async () => {
    await expect(rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/badparse"] }))).rejects.toThrow(
      /rss: error parsing xml from https:\/\/ex.com\/badparse/,
    );
  });

  test("warns on extractFeedTitle parse failure when feed has no title", async () => {
    const badUrl = "not-a-valid-url";
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(rssNoChannelTitleFeedFixture()));

    const items = await rssAdapter.fetch(rssCfg({ urls: [badUrl] }));
    expect(items.length).toBe(1);
    expect(items[0].source).toBe(badUrl);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^rss: extractHostname failed for "not-a-valid-url": /),
    );
  });

  test("errorMessage on !ok and network", async () => {
    await expectAdapterFetchError(
      mocks.fetchMock,
      [
        {
          fetch: () => rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/badstatus"] })),
          throwMatcher: /rss: failed to fetch/,
        },
        {
          networkError: new Error("connection refused"),
          fetch: () => rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/neterr"] })),
          throwMatcher: /rss: error fetching/,
          spy: "called",
        },
      ],
    );
  });
});
