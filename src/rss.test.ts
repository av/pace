import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import rssAdapter from "./adapters/rss";
import * as typesMod from "./adapters/types";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite({ restoreAllMocks: true });
const rssCfg = (params: Record<string, unknown> = {}) => adapterCfg("rss", params);

function makeResponse(body: string, ok = true, status = 200): Response {
  return new Response(body, {
    status: ok ? 200 : status,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

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
    return Promise.resolve(makeResponse(atomFixture));
  }
  if (url.includes("mixed")) {
    return Promise.resolve(makeResponse(mixedLinkFixture));
  }
  if (url.includes("badstatus")) {
    return Promise.resolve(makeResponse("", false, 404));
  }
  if (url.includes("badparse")) {
    return Promise.resolve(makeResponse("<?xml><invalid>not closed"));
  }
  return Promise.resolve(makeResponse(rssFixture));
}

describe("rss", () => {
  test("ngb contract", () => {
    expect(rssAdapter.name).toBe("rss");
    expect(typeof rssAdapter.fetch).toBe("function");
  });

  beforeEach(() => {
    mocks.fetchMock.mockImplementation(defaultFetchImpl);
  });

  test("returns [] and no fetch when no urls configured", async () => {
    const items = await rssAdapter.fetch(rssCfg({ urls: [] }));
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
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
        return makeResponse(overlapFixture);
      }
      return makeResponse(rssFixture);
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
    mocks.fetchMock.mockResolvedValue(makeResponse(noTitleFixture));

    const items = await rssAdapter.fetch(rssCfg({ urls: [badUrl] }));
    expect(items.length).toBe(1);
    expect(items[0].source).toBe(badUrl);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^rss: extractFeedTitle could not parse url "not-a-valid-url": /),
    );
  });

  test("errorMessage on !ok and network", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
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