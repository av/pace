import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import type { Adapter, AdapterConfig } from "./adapters/types";
import rssAdapter from "./adapters/rss";
import producthuntAdapter from "./adapters/producthunt";

const TYPES_TS = path.join(import.meta.dir, "adapters", "types.ts");
const originalFetch = globalThis.fetch;

function adapterFetchJsDoc(): string {
  const src = fs.readFileSync(TYPES_TS, "utf8");
  const block = src.match(
    /export interface Adapter[\s\S]*?\/\*\*([\s\S]*?)\*\/\s*fetch\(config: AdapterConfig\)/,
  );
  if (!block) throw new Error("Adapter.fetch JSDoc not found in types.ts");
  return block[1];
}

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
  describe("Adapter.fetch JSDoc", () => {
    test("required fetch failures throw for scheduler lastError", () => {
      const doc = adapterFetchJsDoc();
      expect(doc).toMatch(/Throw.*\$\{name\}/);
      expect(doc).toMatch(/scheduler/);
      expect(doc).toMatch(/lastError/);
      expect(doc).toMatch(/network\/timeout/);
      expect(doc).toMatch(/Never downgrade these to `console\.warn` \+ `\[\]`/);
    });

    test("empty sources return [] without throwing", () => {
      const doc = adapterFetchJsDoc();
      expect(doc).toMatch(/Return `\[\]` without throwing/);
      expect(doc).toMatch(/empty source[\s\S]*lists in `params`/);
      expect(doc).toMatch(/zero usable entries/);
      expect(doc).toMatch(/misconfiguration/);
    });

    test("optional secondary fetches warn and continue", () => {
      const doc = adapterFetchJsDoc();
      expect(doc).toMatch(/Warn and continue only for optional secondary fetches/);
      expect(doc).toMatch(/per-item enrichment/);
      expect(doc).toMatch(/account lookup/);
      expect(doc).toMatch(/skip that item, return[\s\S]*the rest/);
    });
  });

  describe("Adapter.fetch contract (reference)", () => {
    test("Adapter interface requires name and fetch", () => {
      const adapter: Adapter = {
        name: "stub",
        fetch: async (_config: AdapterConfig) => [],
      };
      expect(adapter.name).toBe("stub");
      expect(adapter.fetch({ type: "stub" })).toBeInstanceOf(Promise);
    });

    describe("rss", () => {
      let fetchCalls: string[];

      beforeEach(() => {
        fetchCalls = [];
        globalThis.fetch = (async (input: string | URL) => {
          fetchCalls.push(String(input));
          if (String(input).includes("badstatus")) {
            return new Response("", { status: 404 });
          }
          return new Response(rssEmptyChannelFixture(), {
            headers: { "Content-Type": "application/xml" },
          });
        }) as typeof fetch;
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      test("empty urls: [] without fetch or throw", async () => {
        const items = await rssAdapter.fetch({ type: "rss", params: { urls: [] } });
        expect(items).toEqual([]);
        expect(fetchCalls).toHaveLength(0);
      });

      test("primary HTTP !ok: throws, not warn+[]", async () => {
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        try {
          await expect(
            rssAdapter.fetch({
              type: "rss",
              params: { urls: ["https://ex.com/badstatus"] },
            }),
          ).rejects.toThrow(/rss: failed to fetch/);
          expect(warnSpy).not.toHaveBeenCalled();
        } finally {
          warnSpy.mockRestore();
        }
      });
    });

    describe("producthunt", () => {
      let fetchMock: ReturnType<typeof mock>;

      beforeEach(() => {
        fetchMock = mock();
        globalThis.fetch = fetchMock as typeof fetch;
      });

      afterEach(() => {
        globalThis.fetch = originalFetch;
      });

      test("empty feed: [] with misconfiguration warn, no throw", async () => {
        fetchMock.mockResolvedValue(
          new Response(
            `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
            { status: 200 },
          ),
        );
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        try {
          const items = await producthuntAdapter.fetch({ type: "producthunt" });
          expect(items).toEqual([]);
          expect(warnSpy).toHaveBeenCalledWith("producthunt: no entries found in feed");
        } finally {
          warnSpy.mockRestore();
        }
      });

      test("primary feed HTTP !ok: throws, not warn+[]", async () => {
        fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        try {
          await expect(producthuntAdapter.fetch({ type: "producthunt" })).rejects.toThrow(
            /producthunt: failed to fetch feed: HTTP error 429/,
          );
          expect(warnSpy).not.toHaveBeenCalled();
        } finally {
          warnSpy.mockRestore();
        }
      });

      test("enrich HTTP !ok: warns per item and returns feed items", async () => {
        fetchMock.mockImplementation(async (url: string) => {
          if (String(url).includes("feed")) {
            return new Response(phFeedFixture(), { status: 200 });
          }
          return new Response("not found", { status: 404 });
        });
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        try {
          const items = await producthuntAdapter.fetch({
            type: "producthunt",
            params: { enrich: true },
          });
          expect(items.length).toBe(1);
          const enrichWarns = warnSpy.mock.calls.filter((c) =>
            String(c[0]).startsWith("producthunt: enrich failed for"),
          );
          expect(enrichWarns).toHaveLength(1);
        } finally {
          warnSpy.mockRestore();
        }
      });
    });
  });
});

const rssEmptyChannelFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty</title></channel></rss>`;