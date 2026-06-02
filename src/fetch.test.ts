import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fetchText, fetchWithTimeout } from "./adapters/fetch";

const originalFetch = globalThis.fetch;

describe("fetchWithTimeout", () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(async () => new Response("ok"));
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends default User-Agent and AbortSignal.timeout", async () => {
    await fetchWithTimeout("https://example.com/feed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/feed");
    expect(init.headers).toMatchObject({ "User-Agent": "pace/1.0" });
    expect(init.signal).toBeDefined();
  });

  test("merges custom userAgent, headers, and accept", async () => {
    await fetchWithTimeout("https://example.com/api", {
      userAgent: "custom-agent/2",
      headers: { "X-Custom": "1" },
      accept: "application/json",
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "User-Agent": "custom-agent/2",
      "X-Custom": "1",
      Accept: "application/json",
    });
  });

  test("does not check res.ok — returns non-2xx responses", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));

    const res = await fetchWithTimeout("https://example.com/missing");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });
});

describe("fetchText", () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns response body on success", async () => {
    fetchMock.mockResolvedValue(new Response("feed body", { status: 200 }));

    const text = await fetchText("rss", "https://example.com/feed.xml");
    expect(text).toBe("feed body");
  });

  test("throws error fetching on transport failure", async () => {
    fetchMock.mockRejectedValue(new Error("connection reset"));

    await expect(fetchText("rss", "https://example.com/feed.xml")).rejects.toThrow(
      "rss: error fetching https://example.com/feed.xml: connection reset",
    );
  });

  test("throws failed to fetch on non-2xx HTTP", async () => {
    fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));

    await expect(fetchText("arxiv", "https://example.com/query")).rejects.toThrow(
      /^arxiv: failed to fetch https:\/\/example\.com\/query: HTTP error 404$/,
    );
  });

  test("uses custom context in error messages", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));

    await expect(
      fetchText("podcast", "https://example.com/feed.xml", "episode feed"),
    ).rejects.toThrow("podcast: error fetching episode feed: timeout");
  });

  test("throws error reading when body read fails", async () => {
    fetchMock.mockResolvedValue({
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