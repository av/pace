import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import podcastAdapter from "./adapters/podcast";
import type { AdapterConfig } from "./adapters/types";
import * as typesMod from "./adapters/types";

const originalFetch = globalThis.fetch;

const defaultCfg: AdapterConfig = { type: "podcast" };

function podcastCfg(params: Record<string, unknown> = {}): AdapterConfig {
  return { ...defaultCfg, params };
}

function makeErrorResponse(status: number): Response {
  return new Response("", { status });
}

function makePodcastFeedFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Test Podcast Show</title>
    <link>https://example.com/podcast</link>
    <item>
      <title>Episode One Title</title>
      <link>https://example.com/ep1</link>
      <enclosure url="https://audio.com/ep1.mp3" type="audio/mpeg" />
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
      <itunes:duration>12:34</itunes:duration>
      <description>Some desc here with &amp; stuff</description>
      <itunes:episode>1</itunes:episode>
      <itunes:season>1</itunes:season>
      <itunes:author>Host One</itunes:author>
    </item>
    <item>
      <title>Episode Two</title>
      <enclosure url="https://audio.com/ep2.mp3" />
      <pubDate>2024-01-02</pubDate>
      <description>Second episode short</description>
    </item>
    <item>
      <title>Bad Item No Title</title>
    </item>
  </channel>
</rss>`;
}

function makeNoChannelFixture(): string {
  return `<?xml version="1.0"?><rss><foo>no channel</foo></rss>`;
}

describe("podcast adapter", () => {
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof spyOn>;

  test("satisfies ngb contract: default export has .name and .fetch", () => {
    expect(podcastAdapter.name).toBe("podcast");
    expect(typeof podcastAdapter.fetch).toBe("function");
  });

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("returns empty when no feeds configured", async () => {
    const items = await podcastAdapter.fetch(podcastCfg());
    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetches single feed and maps episodes with correct id/source/timestamp/body (duration, show, ep, audio, desc)", async () => {
    fetchMock.mockResolvedValue(
      new Response(makePodcastFeedFixture(), {
        status: 200,
        headers: { "content-type": "application/xml" },
      }),
    );

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://example.com/feed.xml"] }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = String(fetchMock.mock.calls[0][0]);
    expect(callUrl).toBe("https://example.com/feed.xml");
    // headers check optional but UA present in impl
    expect(items.length).toBe(3); // 3 items (bad one has title so included, url may be empty)
    expect(items[0].id).toContain("podcast:test-podcast-show:");
    expect(items[0].title).toBe("Episode One Title");
    expect(items[0].url).toBe("https://example.com/ep1");
    expect(items[0].source).toBe("podcast:test-podcast-show");
    expect(items[0].timestamp).toBeInstanceOf(Date);
    expect(items[0].body).toContain("Duration: 12:34");
    expect(items[0].body).toContain("Show: Test Podcast Show");
    expect(items[0].body).toContain("S01E01");
    expect(items[0].body).toContain("Description: Some desc here with & stuff");
    expect(items[0].body).toContain("Audio: https://audio.com/ep1.mp3");
    expect(items[1].title).toBe("Episode Two");
  });

  test("respects limit param (caps per-feed)", async () => {
    fetchMock.mockResolvedValue(
      new Response(makePodcastFeedFixture(), { status: 200 }),
    );

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://ex.com/f.xml"], limit: 1 }),
    );

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Episode One Title");
  });

  test("fetches multiple feeds and dedupes episodes by url", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(makePodcastFeedFixture(), { status: 200 }),
    );

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://a.com/1.xml", "https://b.com/2.xml"] }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(items.length).toBe(3);
    expect(items.map((i) => i.url)).toEqual([
      "https://example.com/ep1",
      "https://audio.com/ep2.mp3",
      "",
    ]);
  });

  test("throws on HTTP !ok from feed (contract; no swallow)", async () => {
    fetchMock.mockResolvedValue(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      podcastAdapter.fetch(podcastCfg({ feeds: ["https://bad.com/404.xml"] })),
    ).rejects.toThrow(/podcast:.*failed to fetch https:\/\/bad\.com\/404\.xml.*404/);
  });

  test("warns and returns [] when no channel found in feed XML", async () => {
    fetchMock.mockResolvedValue(
      new Response(makeNoChannelFixture(), { status: 200 }),
    );

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://ex.com/nochan.xml"] }),
    );

    expect(items).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("podcast: no channel found in feed https://ex.com/nochan.xml"),
    );
  });

  test("throws on network/fetch reject error (contract; no swallow)", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      podcastAdapter.fetch(podcastCfg({ feeds: ["https://netfail.com/f.xml"] })),
    ).rejects.toThrow(/podcast: error fetching https:\/\/netfail\.com\/f\.xml.*connection refused/);
  });

  test("uses errorMessage helper in fetch !ok error path", async () => {
    const errorMessageSpy = spyOn(typesMod, "errorMessage");
    fetchMock.mockResolvedValue(makeErrorResponse(404));

    await expect(
      podcastAdapter.fetch(podcastCfg({ feeds: ["https://example.com/podcast.xml"] })),
    ).rejects.toThrow(/podcast: failed to fetch .*404/);

    expect(errorMessageSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(errorMessageSpy).toHaveBeenCalledWith({ message: "404" });
    errorMessageSpy.mockRestore();
  });
});
