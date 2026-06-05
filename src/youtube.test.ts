import { beforeEach, describe, expect, it } from "bun:test";
import adapter from "./adapters/youtube";
import { FEED_XML_ACCEPT } from "./adapters/fetch";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";
import { makeErrorResponse, makeXmlResponse } from "./test/fetch-responses";

const mocks = useFetchMockSuite();
const youtubeCfg = (params: Record<string, unknown> = {}) => adapterCfg("youtube", params);

function makeYoutubeChannelFeedFixture(entryCount: number): string {
  const entries = Array.from({ length: entryCount }, (_, i) => {
    const n = entryCount - i;
    return `  <entry>
    <yt:videoId>vid${n}</yt:videoId>
    <title>Video ${n}</title>
    <published>2024-01-${String(n).padStart(2, "0")}T00:00:00Z</published>
  </entry>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <title>Multi Channel</title>
${entries}
</feed>`;
}

describe("youtube", () => {
  const channelXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Channel One</title>
  <entry>
    <yt:videoId>vid1</yt:videoId>
    <title>Video 1 Title</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=vid1" />
    <published>2024-01-01T00:00:00Z</published>
    <media:group>
      <media:description>Desc 1</media:description>
    </media:group>
    <author><name>Chan1</name></author>
  </entry>
  <entry>
    <yt:videoId>vid2</yt:videoId>
    <title>Video 2 Title</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=vid2" />
    <published>2024-01-02T00:00:00Z</published>
    <media:group>
      <media:description>Desc 2</media:description>
    </media:group>
  </entry>
</feed>`;

  const playlistXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Playlist One</title>
  <entry>
    <yt:videoId>pl1</yt:videoId>
    <title>PL Video 1</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=pl1" />
    <published>2024-02-01T00:00:00Z</published>
    <media:group>
      <media:description>PL Desc</media:description>
    </media:group>
  </entry>
</feed>`;

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
    const overlapPlaylistXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Overlap Playlist</title>
  <entry>
    <yt:videoId>vid1</yt:videoId>
    <title>Video 1 From Playlist</title>
    <published>2024-03-01T00:00:00Z</published>
  </entry>
</feed>`;
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("channel_id=CH1")) {
        return makeXmlResponse(channelXml);
      }
      if (urlStr.includes("playlist_id=OVERLAP")) {
        return makeXmlResponse(overlapPlaylistXml);
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
    const htmlDescXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <title>HTML Desc Channel</title>
  <entry>
    <yt:videoId>html1</yt:videoId>
    <title>HTML Video</title>
    <published>2024-05-01T00:00:00Z</published>
    <media:group>
      <media:description><![CDATA[<p>Hello &amp; <b>world</b></p>]]></media:description>
    </media:group>
    <author><name>HTML Author</name></author>
  </entry>
</feed>`;
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes("channel_id=HTML")) {
        return makeXmlResponse(htmlDescXml);
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(youtubeCfg({ channels: ["HTML"], limit: 5 }));
    expect(items[0].body).toBe("by HTML Author | Hello & world");
  });

  it("decodes HTML entities in channel and entry titles", async () => {
    const entityXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <title>Chan &amp; Co &#8364;</title>
  <entry>
    <yt:videoId>ent1</yt:videoId>
    <title>Rock &amp; Roll &#8364;</title>
    <published>2024-04-01T00:00:00Z</published>
  </entry>
</feed>`;
    mocks.fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes("channel_id=ENT")) {
        return makeXmlResponse(entityXml);
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

  it.each([NaN, "10", Infinity, -5, 0] as unknown[])(
    "invalid limit (%s) uses default slice of 15 per feed",
    async (limit) => {
      mocks.fetchMock.mockImplementation(async (url: string | URL) => {
        if (String(url).includes("channel_id=MULTI")) {
          return makeXmlResponse(makeYoutubeChannelFeedFixture(20));
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
        return makeXmlResponse(makeYoutubeChannelFeedFixture(60));
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
        return makeXmlResponse(makeYoutubeChannelFeedFixture(5));
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