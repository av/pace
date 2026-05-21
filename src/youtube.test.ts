import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import adapter from "./adapters/youtube";
import type { AdapterConfig } from "./adapters/types";

describe("youtube adapter", () => {
  let originalFetch: typeof globalThis.fetch;

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
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("channel_id=CH1")) {
        return new Response(channelXml, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      if (urlStr.includes("playlist_id=PL1")) {
        return new Response(playlistXml, {
          status: 200,
          headers: { "content-type": "application/xml" },
        });
      }
      if (urlStr.includes("channel_id=ERR")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns empty when no channels or playlists configured", async () => {
    const items = await adapter.fetch({ params: {} } as AdapterConfig);
    expect(items).toEqual([]);
  });

  it("fetches from channel and maps items with correct title/source/url/body", async () => {
    const items = await adapter.fetch({
      params: { channels: ["CH1"], limit: 10 },
    } as AdapterConfig);
    expect(items.length).toBe(2);
    expect(items[0].id).toBe("youtube:vid1");
    expect(items[0].title).toBe("Video 1 Title");
    expect(items[0].source).toBe("youtube:Channel One");
    expect(items[0].url).toContain("vid1");
    expect(items[0].body).toBe("Desc 1");
    expect(items[1].title).toBe("Video 2 Title");
  });

  it("fetches from playlist and maps items", async () => {
    const items = await adapter.fetch({
      params: { playlists: ["PL1"], limit: 5 },
    } as AdapterConfig);
    expect(items.length).toBe(1);
    expect(items[0].title).toBe("PL Video 1");
    expect(items[0].source).toBe("youtube:Playlist One");
    expect(items[0].body).toBe("PL Desc");
  });

  it("fetches combined channels + playlists (limit passed per feed, total not capped)", async () => {
    const items = await adapter.fetch({
      params: { channels: ["CH1"], playlists: ["PL1"], limit: 2 },
    } as AdapterConfig);
    expect(items.length).toBe(3); // 2 channel + 1 playlist
  });

  it("handles error on one feed (404 returns [] for it) and succeeds on others", async () => {
    const items = await adapter.fetch({
      params: { channels: ["ERR"], playlists: ["PL1"] },
    } as AdapterConfig);
    expect(items.length).toBe(1); // only playlist succeeds
  });

  it("respects per-feed limit", async () => {
    const items = await adapter.fetch({
      params: { channels: ["CH1"], limit: 1 },
    } as AdapterConfig);
    expect(items.length).toBe(1);
  });
});
