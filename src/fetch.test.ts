import { beforeEach, describe, expect, test } from "bun:test";
import {
  ARXIV_FETCH_TIMEOUT_MS,
  buildGitHubApiHeaders,
  DEFAULT_FETCH_TIMEOUT_MS,
  FEED_FETCH_TIMEOUT_MS,
  FEED_XML_ACCEPT,
  fetchJson,
  fetchText,
  fetchWithTimeout,
  GITHUB_API_ACCEPT,
  HN_ITEM_FETCH_TIMEOUT_MS,
  PACE_FEED_USER_AGENT,
  PACE_USER_AGENT,
} from "./adapters/fetch";
import { useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    mocks.fetchMock.mockImplementation(async () => new Response("ok"));
  });

  test("sends default User-Agent and AbortSignal.timeout", async () => {
    await fetchWithTimeout("https://example.com/feed");

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/feed");
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

    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "User-Agent": "custom-agent/2",
      "X-Custom": "1",
      Accept: "application/json",
    });
  });

  test("does not check res.ok — returns non-2xx responses", async () => {
    mocks.fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));

    const res = await fetchWithTimeout("https://example.com/missing");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });
});

describe("fetchText / fetchJson default User-Agent", () => {
  test("fetchText and fetchJson share default feed User-Agent via fetchWithTimeout", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await fetchText("rss", "https://example.com/feed.xml");
    const textUa = (mocks.fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;

    mocks.fetchMock.mockClear();
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await fetchJson("npm", "https://example.com/search");
    const jsonUa = (mocks.fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;

    expect(textUa["User-Agent"]).toBe(PACE_FEED_USER_AGENT);
    expect(jsonUa["User-Agent"]).toBe(PACE_FEED_USER_AGENT);
    expect(textUa["User-Agent"]).toBe(jsonUa["User-Agent"]);
  });
});

describe("fetchText", () => {
  test("returns response body on success", async () => {
    mocks.fetchMock.mockResolvedValue(new Response("feed body", { status: 200 }));

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
    mocks.fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));

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

describe("fetchJson", () => {
  test("returns parsed JSON on success", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [1, 2] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

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
    mocks.fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));

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