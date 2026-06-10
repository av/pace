import { describe, expect, test } from "bun:test";
import podcastAdapter from "./adapters/podcast";
import { fetchMockCallUrl, useFetchMockSuite, withErrorMessageSpy } from "./test/adapter-mocks";
import { podcastCfg } from "./test/adapter-cfg";
import { makeErrorResponse, makeXmlResponse } from "./test/fetch-responses";
import { invalidLimitParams } from "./test/invalid-params";
import {
  podcastEmptyFeedFixture,
  podcastFeedFixture,
  podcastLongDescriptionFeedFixture,
  podcastMultiEpisodeFeedFixture,
  podcastNoChannelFixture,
} from "./test/podcast-fixtures";

const mocks = useFetchMockSuite();


describe("podcast", () => {
  test("returns empty when no feeds configured", async () => {
    const items = await podcastAdapter.fetch(podcastCfg());
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalledWith("podcast: no feeds configured");
  });

  test("returns [] and no fetch when feeds are only blank strings", async () => {
    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["", "  "] }),
    );
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalledWith("podcast: no feeds configured");
  });

  test("fetches single feed and maps episodes with correct id/source/timestamp/body (duration, show, ep, audio, desc)", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(podcastFeedFixture()));

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://example.com/feed.xml"] }),
    );

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(callUrl).toBe("https://example.com/feed.xml");
    // headers check optional but UA present in impl
    expect(items.length).toBe(3); // 3 items (bad one has title so included, url may be empty)
    const episodeOne = items.find((i) => i.title === "Episode One Title");
    expect(episodeOne?.id).toContain("podcast:test-podcast-show:");
    expect(episodeOne?.url).toBe("https://example.com/ep1");
    expect(episodeOne?.source).toBe("podcast:test-podcast-show");
    expect(episodeOne?.timestamp).toBeInstanceOf(Date);
    expect(episodeOne?.body).toContain("Duration: 12:34");
    expect(episodeOne?.body).toContain("Show: Test Podcast Show");
    expect(episodeOne?.body).toContain("S01E01");
    expect(episodeOne?.body).toContain("Description: Some desc here with & stuff");
    expect(episodeOne?.body).toContain("Audio: https://audio.com/ep1.mp3");
    expect(items.find((i) => i.title === "Episode Two")).toBeDefined();
  });

  test("truncates long episode descriptions in body", async () => {
    const longDesc = "d".repeat(250);
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(podcastLongDescriptionFeedFixture(longDesc)));

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://example.com/feed.xml"] }),
    );

    const descPart = items[0].body?.match(/Description: (.+)/)?.[1];
    expect(descPart).toBe(`${"d".repeat(200)}...`);
    expect(descPart?.length).toBe(203);
  });

  test("respects limit param (caps per-feed)", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(podcastFeedFixture()));

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://ex.com/f.xml"], limit: 1 }),
    );

    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Episode One Title");
  });

  test.each(invalidLimitParams(10))(
    "invalid limit (%s) uses default slice of 10 per feed",
    async (limit) => {
      mocks.fetchMock.mockResolvedValue(makeXmlResponse(podcastMultiEpisodeFeedFixture(15)));

      const items = await podcastAdapter.fetch(
        podcastCfg({ feeds: ["https://ex.com/f.xml"], limit }),
      );

      expect(items.length).toBe(10);
      expect(items[0].title).toBe("Episode 15");
    },
  );

  test("caps limit at 50 per feed", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(podcastMultiEpisodeFeedFixture(60)));

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://ex.com/f.xml"], limit: 500 }),
    );

    expect(items.length).toBe(50);
  });

  test("floors fractional limit per feed", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(podcastMultiEpisodeFeedFixture(5)));

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://ex.com/f.xml"], limit: 2.9 }),
    );

    expect(items.length).toBe(2);
    expect(items[0].title).toBe("Episode 5");
    expect(items[1].title).toBe("Episode 4");
  });

  test("fetches multiple feeds and dedupes episodes by url", async () => {
    mocks.fetchMock.mockImplementation(async () => makeXmlResponse(podcastFeedFixture()));

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://a.com/1.xml", "https://b.com/2.xml"] }),
    );

    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    expect(items.length).toBe(3);
    expect(items.map((i) => i.url)).toEqual([
      "",
      "https://audio.com/ep2.mp3",
      "https://example.com/ep1",
    ]);
  });

  test("throws on HTTP !ok from feed (contract; no swallow)", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(404));

    await expect(
      podcastAdapter.fetch(podcastCfg({ feeds: ["https://bad.com/404.xml"] })),
    ).rejects.toThrow(/podcast:.*failed to fetch https:\/\/bad\.com\/404\.xml.*404/);
  });

  test("throws on malformed XML with adapter prefix (contract; no swallow)", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse("<?xml><broken>"));

    await expect(
      podcastAdapter.fetch(podcastCfg({ feeds: ["https://ex.com/bad.xml"] })),
    ).rejects.toThrow(/podcast: error parsing xml from https:\/\/ex\.com\/bad\.xml/);
  });

  test("warns and returns [] when no channel found in feed XML", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(podcastNoChannelFixture()));

    const items = await podcastAdapter.fetch(
      podcastCfg({ feeds: ["https://ex.com/nochan.xml"] }),
    );

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "podcast: no channel found on feed https://ex.com/nochan.xml",
    );
  });

  test("warns and returns [] when feed has channel but no episodes", async () => {
    mocks.fetchMock.mockResolvedValue(makeXmlResponse(podcastEmptyFeedFixture()));

    const feedUrl = "https://ex.com/empty.xml";
    const items = await podcastAdapter.fetch(podcastCfg({ feeds: [feedUrl] }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      `podcast: no entries found in ${feedUrl}`,
    );
  });

  test("throws on network/fetch reject error (contract; no swallow)", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      podcastAdapter.fetch(podcastCfg({ feeds: ["https://netfail.com/f.xml"] })),
    ).rejects.toThrow(/podcast: error fetching https:\/\/netfail\.com\/f\.xml.*connection refused/);
  });

  test("errorMessage on !ok", async () => {
    await withErrorMessageSpy(async (emSpy) => {
      mocks.fetchMock.mockResolvedValue(makeErrorResponse(404));

      await expect(
        podcastAdapter.fetch(podcastCfg({ feeds: ["https://example.com/podcast.xml"] })),
      ).rejects.toThrow(/podcast: failed to fetch .*404/);

      expect(emSpy).toHaveBeenCalledTimes(1);
      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 404" });
    });
  });
});
