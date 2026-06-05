import { beforeEach, describe, expect, test } from "bun:test";
import type { Adapter, AdapterConfig } from "./adapters/types";
import rssAdapter from "./adapters/rss";
import producthuntAdapter from "./adapters/producthunt";
import { useFetchMockSuite } from "./test/adapter-mocks";
import { makeErrorResponse, makeXmlResponse } from "./test/fetch-responses";
import { productHuntFeedFixture } from "./test/producthunt-fixtures";

const mocks = useFetchMockSuite();

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
            return makeErrorResponse(404);
          }
          return makeXmlResponse(rssEmptyChannelFixture());
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
          makeXmlResponse(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`),
        );
        const items = await producthuntAdapter.fetch({ type: "producthunt" });
        expect(items).toEqual([]);
        expect(mocks.warnSpy).toHaveBeenCalledWith("producthunt: no entries found in feed");
      });

      test("primary feed HTTP !ok: throws, not warn+[]", async () => {
        mocks.fetchMock.mockResolvedValue(makeErrorResponse(429));
        await expect(producthuntAdapter.fetch({ type: "producthunt" })).rejects.toThrow(
          /producthunt: failed to fetch feed: HTTP error 429/,
        );
        expect(mocks.warnSpy).not.toHaveBeenCalled();
      });

      test("enrich HTTP !ok: warns per item and returns feed items", async () => {
        mocks.fetchMock.mockImplementation(async (url: string) => {
          if (String(url).includes("feed")) {
            return makeXmlResponse(productHuntFeedFixture(1));
          }
          return makeErrorResponse(404);
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