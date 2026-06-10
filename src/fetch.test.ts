import { beforeEach, describe, expect, test } from "bun:test";
import { podcastFeedXmlParser } from "./adapters/atom";
import {
  ARXIV_FETCH_TIMEOUT_MS,
  buildGitHubApiHeaders,
  DEFAULT_FETCH_TIMEOUT_MS,
  FEED_FETCH_TIMEOUT_MS,
  FEED_XML_ACCEPT,
  arrayFieldOrEmpty,
  fetchAtomFeed,
  fetchRssAtomFeed,
  fetchJson,
  fetchText,
  fetchWithTimeout,
  GITHUB_API_ACCEPT,
  HN_ITEM_FETCH_TIMEOUT_MS,
  PACE_FEED_USER_AGENT,
  PACE_USER_AGENT,
  tryOptionalFetch,
} from "./adapters/fetch";
import { spyConsole } from "./test/console-spy";
import {
  fetchMockCallHeaders,
  fetchMockCallInit,
  fetchMockCallUrl,
  useFetchMockSuite,
} from "./test/adapter-mocks";
import {
  makeErrorResponse,
  makeJsonResponse,
  makeTextResponse,
  makeXmlResponse,
} from "./test/fetch-responses";

const mocks = useFetchMockSuite();

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    mocks.fetchMock.mockImplementation(async () => makeTextResponse("ok"));
  });

  test("sends default User-Agent and AbortSignal.timeout", async () => {
    await fetchWithTimeout("https://example.com/feed");

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMockCallUrl(mocks.fetchMock)).toBe("https://example.com/feed");
    const init = fetchMockCallInit(mocks.fetchMock)!;
    expect(init.headers).toMatchObject({ "User-Agent": PACE_FEED_USER_AGENT });
    expect(init.signal).toBeDefined();
  });

  test("PACE_USER_AGENT is exported for short overrides", () => {
    expect(PACE_USER_AGENT).toBe("pace/1.0");
  });

  test("DEFAULT_FETCH_TIMEOUT_MS is exported for adapters matching the default", () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(15_000);
  });

  test("adapter-specific fetch timeouts are exported", () => {
    expect(HN_ITEM_FETCH_TIMEOUT_MS).toBe(10_000);
    expect(FEED_FETCH_TIMEOUT_MS).toBe(20_000);
    expect(ARXIV_FETCH_TIMEOUT_MS).toBe(30_000);
  });

  test("buildGitHubApiHeaders sets Accept and optional Bearer token", () => {
    expect(buildGitHubApiHeaders()).toEqual({ Accept: GITHUB_API_ACCEPT });
    expect(buildGitHubApiHeaders("ghp_test")).toEqual({
      Accept: GITHUB_API_ACCEPT,
      Authorization: "Bearer ghp_test",
    });
  });

  test("FEED_XML_ACCEPT covers RSS, Atom, and generic XML feed types", () => {
    expect(FEED_XML_ACCEPT).toContain("application/rss+xml");
    expect(FEED_XML_ACCEPT).toContain("application/atom+xml");
    expect(FEED_XML_ACCEPT).toContain("application/xml");
    expect(FEED_XML_ACCEPT).toContain("text/xml");
  });

  test("merges custom userAgent, headers, and accept", async () => {
    await fetchWithTimeout("https://example.com/api", {
      userAgent: "custom-agent/2",
      headers: { "X-Custom": "1" },
      accept: "application/json",
      timeoutMs: 5_000,
    });

    const init = fetchMockCallInit(mocks.fetchMock)!;
    expect(init.headers).toMatchObject({
      "User-Agent": "custom-agent/2",
      "X-Custom": "1",
      Accept: "application/json",
    });
  });

  test("does not check res.ok — returns non-2xx responses", async () => {
    mocks.fetchMock.mockResolvedValue(makeTextResponse("nope", 503));

    const res = await fetchWithTimeout("https://example.com/missing");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });
});

describe("fetchText / fetchJson default User-Agent", () => {
  test("fetchText and fetchJson share default feed User-Agent via fetchWithTimeout", async () => {
    mocks.fetchMock.mockResolvedValue(makeJsonResponse({ ok: true }));

    await fetchText("rss", "https://example.com/feed.xml");
    const textUa = fetchMockCallHeaders(mocks.fetchMock);

    mocks.fetchMock.mockClear();
    mocks.fetchMock.mockResolvedValue(makeJsonResponse({ ok: true }));

    await fetchJson("npm", "https://example.com/search");
    const jsonUa = fetchMockCallHeaders(mocks.fetchMock);

    expect(textUa["User-Agent"]).toBe(PACE_FEED_USER_AGENT);
    expect(jsonUa["User-Agent"]).toBe(PACE_FEED_USER_AGENT);
    expect(textUa["User-Agent"]).toBe(jsonUa["User-Agent"]);
  });
});

describe("fetchText", () => {
  test("returns response body on success", async () => {
    mocks.fetchMock.mockResolvedValue(makeTextResponse("feed body"));

    const text = await fetchText("rss", "https://example.com/feed.xml");
    expect(text).toBe("feed body");
  });

  test("throws error fetching on transport failure", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("connection reset"));

    await expect(fetchText("rss", "https://example.com/feed.xml")).rejects.toThrow(
      "rss: error fetching https://example.com/feed.xml: connection reset",
    );
  });

  test("throws failed to fetch on non-2xx HTTP", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(404));

    await expect(fetchText("arxiv", "https://example.com/query")).rejects.toThrow(
      /^arxiv: failed to fetch https:\/\/example\.com\/query: HTTP error 404$/,
    );
  });

  test("uses custom context in error messages", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("timeout"));

    await expect(
      fetchText("podcast", "https://example.com/feed.xml", "episode feed"),
    ).rejects.toThrow("podcast: error fetching episode feed: timeout");
  });

  test("throws error reading when body read fails", async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error("stream truncated");
      },
    } as Response);

    await expect(fetchText("rss", "https://example.com/feed.xml")).rejects.toThrow(
      "rss: error reading https://example.com/feed.xml: stream truncated",
    );
  });
});

describe("fetchAtomFeed", () => {
  test("fetches with FEED_XML_ACCEPT, parses feed, and normalizes entries", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Feed</title>
  <entry><id>e1</id><title>One</title></entry>
  <entry><id>e2</id><title>Two</title></entry>
</feed>`;
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(xml));

    const { parsed, entries } = await fetchAtomFeed<
      { id: string; title: string },
      { feed?: { title?: string; entry?: { id: string; title: string } | { id: string; title: string }[] } }
    >("youtube", "https://example.com/feed.xml", "test feed");

    expect(entries).toEqual([
      { id: "e1", title: "One" },
      { id: "e2", title: "Two" },
    ]);
    expect(parsed.feed?.title).toBe("Test Feed");

    expect(fetchMockCallHeaders(mocks.fetchMock).Accept).toBe(FEED_XML_ACCEPT);
  });

  test("normalizes a single entry to a one-element array", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>only</id></entry>
</feed>`;
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(xml));

    const { entries } = await fetchAtomFeed<{ id: string }, { feed?: { entry?: { id: string } } }>(
      "arxiv",
      "https://example.com/query",
    );

    expect(entries).toEqual([{ id: "only" }]);
  });

  test("forwards fetch options such as timeoutMs", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeXmlResponse('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'),
    );

    await fetchAtomFeed("arxiv", "https://example.com/query", "query", {
      timeoutMs: ARXIV_FETCH_TIMEOUT_MS,
    });

    expect(fetchMockCallInit(mocks.fetchMock)?.signal).toBeDefined();
  });

  test("throws on malformed XML with adapter prefix", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse("<?xml><invalid>not closed"));

    await expect(
      fetchAtomFeed("youtube", "https://example.com/feed.xml"),
    ).rejects.toThrow(/youtube: error parsing xml from/);
  });

  test("throws failed to fetch on non-2xx HTTP", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(404));

    await expect(
      fetchAtomFeed("arxiv", "https://example.com/query", "query"),
    ).rejects.toThrow(/^arxiv: failed to fetch query: HTTP error 404$/);
  });
});

describe("fetchRssAtomFeed", () => {
  test("fetches RSS channel items with FEED_XML_ACCEPT", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>RSS Feed</title>
    <item><title>One</title><link>https://example.com/1</link></item>
    <item><title>Two</title><link>https://example.com/2</link></item>
  </channel>
</rss>`;
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(xml));

    const { parsed, items } = await fetchRssAtomFeed<
      { title: string; link: string },
      {
        rss?: {
          channel?: {
            title?: string;
            item?: { title: string; link: string } | { title: string; link: string }[];
          };
        };
      }
    >("rss", "https://example.com/feed.xml");

    expect(items).toEqual([
      { title: "One", link: "https://example.com/1" },
      { title: "Two", link: "https://example.com/2" },
    ]);
    expect(parsed.rss?.channel?.title).toBe("RSS Feed");

    expect(fetchMockCallHeaders(mocks.fetchMock).Accept).toBe(FEED_XML_ACCEPT);
  });

  test("falls back to Atom entries when RSS channel items are absent", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry><title>Atom One</title></entry>
</feed>`;
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(xml));

    const { items } = await fetchRssAtomFeed<{ title: string }, { feed?: { entry?: { title: string } } }>(
      "rss",
      "https://example.com/atom.xml",
    );

    expect(items).toEqual([{ title: "Atom One" }]);
  });

  test("throws on malformed XML with adapter prefix", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse("<?xml><invalid>not closed"));

    await expect(
      fetchRssAtomFeed("rss", "https://example.com/feed.xml"),
    ).rejects.toThrow(/rss: error parsing xml from/);
  });

  test("accepts custom parser for CDATA-heavy feeds", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title><![CDATA[  Podcast Show  ]]></title>
    <item>
      <title><![CDATA[  Episode One  ]]></title>
      <description><![CDATA[  CDATA body  ]]></description>
    </item>
  </channel>
</rss>`;
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(xml));

    const { parsed, items } = await fetchRssAtomFeed<
      { title?: { __cdata?: string }; description?: { __cdata?: string } },
      {
        rss?: {
          channel?: {
            title?: { __cdata?: string };
            item?: { title?: { __cdata?: string }; description?: { __cdata?: string } };
          };
        };
      }
    >("podcast", "https://example.com/feed.xml", "feed.xml", {
      parser: podcastFeedXmlParser,
    });

    expect(parsed.rss?.channel?.title?.__cdata).toBe("  Podcast Show  ");
    expect(items[0]?.title?.__cdata).toBe("  Episode One  ");
    expect(items[0]?.description?.__cdata).toBe("  CDATA body  ");
  });
});

describe("tryOptionalFetch", () => {
  test("returns work result on success", async () => {
    const result = await tryOptionalFetch("hackernews", "item 42", async () => ({ id: 42 }));
    expect(result).toEqual({ id: 42 });
  });

  test("warns and returns null on failure", async () => {
    await spyConsole(["warn"], async ({ warn }) => {
      const result = await tryOptionalFetch("mastodon", "account lookup", async () => {
        throw new Error("network down");
      });

      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledWith("mastodon: account lookup: network down");
    });
  });

  test("passes through errors already prefixed with adapter name", async () => {
    await spyConsole(["warn"], async ({ warn }) => {
      await tryOptionalFetch("producthunt", "enrich failed", async () => {
        throw new Error("producthunt: failed to fetch https://example.com: HTTP error 404");
      });

      expect(warn).toHaveBeenCalledWith(
        "producthunt: failed to fetch https://example.com: HTTP error 404",
      );
    });
  });
});

describe("arrayFieldOrEmpty", () => {
  test("returns array values unchanged, including empty arrays", async () => {
    await spyConsole(["warn"], async ({ warn }) => {
      expect(arrayFieldOrEmpty("reddit", { children: [{ id: 1 }] }, "children", "r/test")).toEqual([
        { id: 1 },
      ]);
      expect(arrayFieldOrEmpty("lemmy", { posts: [] }, "posts", "frontpage")).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  test("warns and returns [] when parent is not an object", async () => {
    await spyConsole(["warn"], async ({ warn }) => {
      expect(arrayFieldOrEmpty("reddit", undefined, "children", "r/test")).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        'reddit: expected array field "children" for r/test (response is not an object), treating as empty',
      );
    });
  });

  test("warns and returns [] when field is missing or wrong type", async () => {
    await spyConsole(["warn"], async ({ warn }) => {
      expect(arrayFieldOrEmpty("npm", {}, "objects", "react")).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        'npm: expected array field "objects" for react (field is missing), treating as empty',
      );

      warn.mockClear();
      expect(arrayFieldOrEmpty("stackexchange", { items: "error" }, "items", "from so")).toEqual(
        [],
      );
      expect(warn).toHaveBeenCalledWith(
        'stackexchange: expected array field "items" for from so (got string), treating as empty',
      );
    });
  });
});

describe("fetchJson", () => {
  test("returns parsed JSON on success", async () => {
    mocks.fetchMock.mockResolvedValue(makeJsonResponse({ items: [1, 2] }));

    const data = await fetchJson<{ items: number[] }>("npm", "https://example.com/search");
    expect(data).toEqual({ items: [1, 2] });
  });

  test("throws error fetching on transport failure", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("connection reset"));

    await expect(fetchJson("npm", "https://example.com/search")).rejects.toThrow(
      "npm: error fetching https://example.com/search: connection reset",
    );
  });

  test("throws failed to fetch on non-2xx HTTP", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(404));

    await expect(fetchJson("github-releases", "https://example.com/releases")).rejects.toThrow(
      /^github-releases: failed to fetch https:\/\/example\.com\/releases: HTTP error 404$/,
    );
  });

  test("uses custom context in error messages", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("timeout"));

    await expect(
      fetchJson("devto", "https://example.com/api", "articles feed"),
    ).rejects.toThrow("devto: error fetching articles feed: timeout");
  });

  test("throws error reading when JSON parse fails", async () => {
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    } as Response);

    await expect(fetchJson("lemmy", "https://example.com/posts")).rejects.toThrow(
      "lemmy: error reading https://example.com/posts: invalid json",
    );
  });
});