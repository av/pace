import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import rssAdapter from "./adapters/rss";
import * as utilsMod from "./utils";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";
import { makeXmlResponse } from "./test/fetch-responses";

const mocks = useFetchMockSuite();
const rssCfg = (params: Record<string, unknown> = {}) => adapterCfg("rss", params);

const rssFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example RSS Feed</title>
    <item>
      <title>Item One</title>
      <link>https://example.com/one</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <description>First item body text</description>
    </item>
    <item>
      <title>Item Two</title>
      <link>https://example.com/two</link>
      <pubDate>2024-01-02T00:00:00Z</pubDate>
      <description>Second item body</description>
    </item>
  </channel>
</rss>`;

const atomFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <entry>
    <title>Atom Item</title>
    <link href="https://example.com/atom1" rel="alternate" />
    <updated>2024-01-03T00:00:00Z</updated>
    <summary>Atom body content here</summary>
  </entry>
</feed>`;

const mixedLinkFixture = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Mixed Link Feed</title>
    <item>
      <title>Link Array Case</title>
      <link>https://example.com/alt</link>
      <link rel="alternate" href="https://example.com/real" />
      <pubDate>2024-01-04</pubDate>
      <description>body for link array</description>
    </item>
  </channel>
</rss>`;

function defaultFetchImpl(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes("atom")) {
    return Promise.resolve(makeXmlResponse(atomFixture));
  }
  if (url.includes("mixed")) {
    return Promise.resolve(makeXmlResponse(mixedLinkFixture));
  }
  if (url.includes("badstatus")) {
    return Promise.resolve(makeXmlResponse("", 404));
  }
  if (url.includes("badparse")) {
    return Promise.resolve(makeXmlResponse("<?xml><invalid>not closed"));
  }
  return Promise.resolve(makeXmlResponse(rssFixture));
}

describe("rss", () => {
  beforeEach(() => {
    mocks.fetchMock.mockImplementation(defaultFetchImpl);
  });

  test("returns [] and no fetch when no urls configured", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: [] }));
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalledWith("rss: no urls configured");
  });

  test("fetches single RSS 2.0 feed and maps fields correctly (string titles/links)", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/rss"] }));
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({
      title: "Item One",
      url: "https://example.com/one",
      source: "Example RSS Feed",
      body: "First item body text",
    });
    expect(items[0].id).toContain("rss:https://example.com/one");
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

  test("merges multiple urls (RSS + Atom)", async () => {
    const items = await rssAdapter.fetch(
      rssCfg({ urls: ["https://ex.com/rss", "https://ex.com/atom"] }),
    );
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    expect(items.length).toBe(3);
  });

  test("dedupes the same item link across multiple feeds", async () => {
    const overlapFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Overlap Feed</title>
    <item>
      <title>Item One Duplicate</title>
      <link>https://example.com/one</link>
      <pubDate>2024-01-05T00:00:00Z</pubDate>
      <description>from second feed</description>
    </item>
  </channel>
</rss>`;
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("overlap")) {
        return makeXmlResponse(overlapFixture);
      }
      return makeXmlResponse(rssFixture);
    });

    const items = await rssAdapter.fetch(
      rssCfg({ urls: ["https://ex.com/rss", "https://ex.com/overlap"] }),
    );
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    expect(items.length).toBe(2);
    expect(items.filter((i) => i.url === "https://example.com/one")).toHaveLength(1);
    expect(items[0].title).toBe("Item One");
    expect(items[0].body).toBe("First item body text");
  });

  test("decodes HTML entities in RSS/Atom feed and entry titles", async () => {
    const entityFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Chan &amp; Co &#8364;</title>
    <item>
      <title>Rock &amp; Roll &#8364;</title>
      <link>https://example.com/entity</link>
      <pubDate>2024-01-08T00:00:00Z</pubDate>
      <description>body</description>
    </item>
  </channel>
</rss>`;
    const atomEntityFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom &amp; Feed &#8364;</title>
  <entry>
    <title>Atom &amp; Entry &#8364;</title>
    <link href="https://example.com/atom-entity" rel="alternate" />
    <updated>2024-01-09T00:00:00Z</updated>
    <summary>atom body</summary>
  </entry>
</feed>`;
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("atom-entity")) {
        return makeXmlResponse(atomEntityFixture);
      }
      if (url.includes("entity")) {
        return makeXmlResponse(entityFixture);
      }
      return defaultFetchImpl(input);
    });

    const rssItems = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/entity"] }));
    expect(rssItems[0].source).toBe("Chan & Co €");
    expect(rssItems[0].title).toBe("Rock & Roll €");

    const atomItems = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/atom-entity"] }));
    expect(atomItems[0].source).toBe("Atom & Feed €");
    expect(atomItems[0].title).toBe("Atom & Entry €");
  });

  test("strips HTML from description and content:encoded bodies", async () => {
    const htmlBodyFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>HTML Body Feed</title>
    <item>
      <title>HTML Item</title>
      <link>https://example.com/html</link>
      <pubDate>2024-01-06T00:00:00Z</pubDate>
      <description><![CDATA[<p>Hello &amp; <b>world</b></p>]]></description>
    </item>
    <item>
      <title>Encoded Item</title>
      <link>https://example.com/encoded</link>
      <pubDate>2024-01-07T00:00:00Z</pubDate>
      <content:encoded><![CDATA[<p>Line &#65; <em>one</em></p>]]></content:encoded>
    </item>
  </channel>
</rss>`;
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(htmlBodyFixture));

    const items = await rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/htmlbody"] }));
    expect(items.length).toBe(2);
    expect(items[0].body).toBe("Hello & world");
    expect(items[1].body).toBe("Line A one");
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
    const noTitleFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Item Without Channel Title</title>
      <link>https://example.com/notitle</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <description>body without channel title</description>
    </item>
  </channel>
</rss>`;
    const badUrl = "not-a-valid-url";
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(noTitleFixture));

    const items = await rssAdapter.fetch(rssCfg({ urls: [badUrl] }));
    expect(items.length).toBe(1);
    expect(items[0].source).toBe(badUrl);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^rss: extractHostname failed for "not-a-valid-url": /),
    );
  });

  test("errorMessage on !ok and network", async () => {
    const emSpy = spyOn(utilsMod, "errorMessage");
    await expect(rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/badstatus"] }))).rejects.toThrow(
      /rss: failed to fetch/,
    );
    expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 404" });

    emSpy.mockClear();

    mocks.fetchMock.mockRejectedValue(new Error("connection refused"));
    await expect(rssAdapter.fetch(rssCfg({ urls: ["https://ex.com/neterr"] }))).rejects.toThrow(
      /rss: error fetching/,
    );
    expect(emSpy).toHaveBeenCalled();
    emSpy.mockRestore();
  });
});