import { beforeEach, describe, expect, it } from "bun:test";
import adapter from "./adapters/youtube";
import { FEED_XML_ACCEPT } from "./adapters/fetch";
import { useFetchMockSuite } from "./test/adapter-mocks";
import { youtubeCfg } from "./test/adapter-cfg";
import { makeErrorResponse, makeXmlResponse } from "./test/fetch-responses";
import { invalidLimitParams } from "./test/invalid-params";
import {
  youtubeChannelOneFeedFixture,
  youtubeEntityTitlesFeedFixture,
  youtubeHtmlDescriptionFeedFixture,
  youtubeMultiEntryChannelFeedFixture,
  youtubeOverlapPlaylistFeedFixture,
  youtubePlaylistOneFeedFixture,
} from "./test/youtube-fixtures";

const mocks = useFetchMockSuite();


describe("youtube", () => {
  const channelXml = youtubeChannelOneFeedFixture();
  const playlistXml = youtubePlaylistOneFeedFixture();

  beforeEach(() => {
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("channel_id=CH1")) {
        return makeXmlResponse(channelXml);
      }
      if (urlStr.includes("playlist_id=PL1")) {
        return makeXmlResponse(playlistXml);
      }
      if (urlStr.includes("channel_id=ERR")) {
        return makeErrorResponse(404);
      }
      return makeErrorResponse(404);
    });
  });

  it("returns empty when no channels or playlists configured", async () => {
    const items = await adapter.fetch(youtubeCfg());
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalledWith("youtube: no channels or playlists configured");
  });

  it("returns [] and no fetch when channels and playlists are only blank strings", async () => {
    const items = await adapter.fetch(
      youtubeCfg({ channels: ["", "  "], playlists: ["  ", ""] }),
    );
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "youtube: no channels or playlists configured",
    );
  });

  it("sends FEED_XML_ACCEPT when fetching channel feed", async () => {
    await adapter.fetch(youtubeCfg({ channels: ["CH1"] }));

    const headers = (mocks.fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers.Accept).toBe(FEED_XML_ACCEPT);
  });

  it("fetches from channel and maps items with correct title/source/url/body", async () => {
    const items = await adapter.fetch(youtubeCfg({ channels: ["CH1"], limit: 10 }));
    expect(items.length).toBe(2);
    expect(items[0].id).toBe("youtube:vid1");
    expect(items[0].title).toBe("Video 1 Title");
    expect(items[0].source).toBe("youtube:Channel One");
    expect(items[0].url).toContain("vid1");
    expect(items[0].body).toBe("by Chan1 | Desc 1");
    expect(items[1].title).toBe("Video 2 Title");
  });

  it("fetches from playlist and maps items", async () => {
    const items = await adapter.fetch(youtubeCfg({ playlists: ["PL1"], limit: 5 }));
    expect(items.length).toBe(1);
    expect(items[0].title).toBe("PL Video 1");
    expect(items[0].source).toBe("youtube:Playlist One");
    expect(items[0].body).toBe("PL Desc");
  });

  it("fetches combined channels + playlists (limit passed per feed, total not capped)", async () => {
    const items = await adapter.fetch(
      youtubeCfg({ channels: ["CH1"], playlists: ["PL1"], limit: 2 }),
    );
    expect(items.length).toBe(3); // 2 channel + 1 playlist
  });

  it("dedupes the same video id across channel and playlist feeds", async () => {
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("channel_id=CH1")) {
        return makeXmlResponse(channelXml);
      }
      if (urlStr.includes("playlist_id=OVERLAP")) {
        return makeXmlResponse(youtubeOverlapPlaylistFeedFixture());
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(
      youtubeCfg({ channels: ["CH1"], playlists: ["OVERLAP"], limit: 10 }),
    );
    expect(items.length).toBe(2);
    expect(items.filter((i) => i.id === "youtube:vid1")).toHaveLength(1);
    expect(items[0].title).toBe("Video 1 Title");
  });

  it("throws when any configured feed fails (!ok), even if others would succeed", async () => {
    await expect(
      adapter.fetch(youtubeCfg({ channels: ["ERR"], playlists: ["PL1"] })),
    ).rejects.toThrow(/youtube:.*failed to fetch channel ERR.*HTTP error 404/);
  });

  it("strips HTML from media:description in body", async () => {
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes("channel_id=HTML")) {
        return makeXmlResponse(youtubeHtmlDescriptionFeedFixture());
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(youtubeCfg({ channels: ["HTML"], limit: 5 }));
    expect(items[0].body).toBe("by HTML Author | Hello & world");
  });

  it("decodes HTML entities in channel and entry titles", async () => {
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes("channel_id=ENT")) {
        return makeXmlResponse(youtubeEntityTitlesFeedFixture());
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(youtubeCfg({ channels: ["ENT"], limit: 5 }));
    expect(items[0].title).toBe("Rock & Roll €");
    expect(items[0].source).toBe("youtube:Chan & Co €");
  });

  it("respects per-feed limit", async () => {
    const items = await adapter.fetch(youtubeCfg({ channels: ["CH1"], limit: 1 }));
    expect(items.length).toBe(1);
  });

  it.each(invalidLimitParams(10))(
    "invalid limit (%s) uses default slice of 15 per feed",
    async (limit) => {
      mocks.fetchMock.mockImplementation(async (url: string | URL) => {
        if (String(url).includes("channel_id=MULTI")) {
          return makeXmlResponse(youtubeMultiEntryChannelFeedFixture(20));
        }
        return makeErrorResponse(404);
      });

      const items = await adapter.fetch(
        youtubeCfg({ channels: ["MULTI"], limit }),
      );

      expect(items.length).toBe(15);
      expect(items[0].title).toBe("Video 20");
    },
  );

  it("caps limit at 50 per feed", async () => {
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes("channel_id=MULTI")) {
        return makeXmlResponse(youtubeMultiEntryChannelFeedFixture(60));
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(
      youtubeCfg({ channels: ["MULTI"], limit: 500 }),
    );

    expect(items.length).toBe(50);
  });

  it("floors fractional limit per feed", async () => {
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes("channel_id=MULTI")) {
        return makeXmlResponse(youtubeMultiEntryChannelFeedFixture(5));
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(
      youtubeCfg({ channels: ["MULTI"], limit: 2.9 }),
    );

    expect(items.length).toBe(2);
    expect(items[0].title).toBe("Video 5");
  });

  it("throws on network error with adapter prefix", async () => {
    mocks.fetchMock.mockImplementation(async () => {
      throw new Error("network boom for youtube test");
    });
    await expect(
      adapter.fetch(youtubeCfg({ channels: ["UCtestchannel"] })),
    ).rejects.toThrow(/youtube:.*error fetching.*network boom for youtube test/);
  });
});