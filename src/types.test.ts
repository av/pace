import { beforeEach, describe, expect, test } from "bun:test";
import type { Adapter, AdapterConfig } from "./adapters/types";
import rssAdapter from "./adapters/rss";
import producthuntAdapter from "./adapters/producthunt";
import { useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();

function phFeedFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:www.producthunt.com,2005:Post/123456</id>
    <title>Test Product</title>
    <content type="html">&lt;p&gt;Tagline&lt;/p&gt;</content>
    <link rel="alternate" href="https://www.producthunt.com/posts/test-product-123456" />
    <published>2024-05-20T10:00:00Z</published>
    <author><name>John Doe</name></author>
  </entry>
</feed>`;
}

describe("types", () => {
  describe("Adapter.fetch contract", () => {
    test("Adapter interface requires name and fetch", async () => {
      const adapter: Adapter = {
        name: "stub",
        fetch: async (_config: AdapterConfig) => [],
      };
      expect(adapter.name).toBe("stub");
      expect(await adapter.fetch({ type: "stub" })).toEqual([]);
    });

    describe("rss", () => {
      beforeEach(() => {
        mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("badstatus")) {
            return new Response("", { status: 404 });
          }
          return new Response(rssEmptyChannelFixture(), {
            headers: { "Content-Type": "application/xml" },
          });
        });
      });

      test("empty urls: [] without fetch or throw", async () => {
        const items = await rssAdapter.fetch({ type: "rss", params: { urls: [] } });
        expect(items).toEqual([]);
        expect(mocks.fetchMock).not.toHaveBeenCalled();
      });

      test("primary HTTP !ok: throws, not warn+[]", async () => {
        await expect(
          rssAdapter.fetch({
            type: "rss",
            params: { urls: ["https://ex.com/badstatus"] },
          }),
        ).rejects.toThrow(/rss: failed to fetch/);
        expect(mocks.warnSpy).not.toHaveBeenCalled();
      });
    });

    describe("producthunt", () => {
      test("empty feed: [] with misconfiguration warn, no throw", async () => {
        mocks.fetchMock.mockResolvedValue(
          new Response(
            `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
            { status: 200 },
          ),
        );
        const items = await producthuntAdapter.fetch({ type: "producthunt" });
        expect(items).toEqual([]);
        expect(mocks.warnSpy).toHaveBeenCalledWith("producthunt: no entries found in feed");
      });

      test("primary feed HTTP !ok: throws, not warn+[]", async () => {
        mocks.fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
        await expect(producthuntAdapter.fetch({ type: "producthunt" })).rejects.toThrow(
          /producthunt: failed to fetch feed: HTTP error 429/,
        );
        expect(mocks.warnSpy).not.toHaveBeenCalled();
      });

      test("enrich HTTP !ok: warns per item and returns feed items", async () => {
        mocks.fetchMock.mockImplementation(async (url: string) => {
          if (String(url).includes("feed")) {
            return new Response(phFeedFixture(), { status: 200 });
          }
          return new Response("not found", { status: 404 });
        });
        const items = await producthuntAdapter.fetch({
          type: "producthunt",
          params: { enrich: true },
        });
        expect(items).toHaveLength(1);
        expect(items[0]?.url).toBe(
          "https://www.producthunt.com/posts/test-product-123456",
        );
        const enrichWarns = mocks.warnSpy.mock.calls.filter((c) =>
          String(c[0]).startsWith("producthunt: failed to fetch"),
        );
        expect(enrichWarns).toHaveLength(1);
        expect(enrichWarns[0][0]).toBe(
          "producthunt: failed to fetch https://www.producthunt.com/posts/test-product-123456: HTTP error 404",
        );
      });
    });
  });
});

const rssEmptyChannelFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty</title></channel></rss>`;