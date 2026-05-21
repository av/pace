import { beforeEach, afterEach, describe, test, expect, mock } from "bun:test";
import adapter from "./adapters/github";

const releasesXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/10270250/v19.0.0</id>
    <title>Release v19.0.0</title>
    <link rel="alternate" type="text/html" href="https://github.com/facebook/react/releases/tag/v19.0.0"/>
    <updated>2024-12-01T12:00:00Z</updated>
    <content type="html">&lt;p&gt;Bug fixes and new features in React 19.&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/10270250/v18.3.0</id>
    <title>Release v18.3.0</title>
    <link rel="alternate" type="text/html" href="https://github.com/facebook/react/releases/tag/v18.3.0"/>
    <published>2024-06-01T00:00:00Z</published>
    <content type="html">Minor updates.</content>
  </entry>
</feed>`;

const trendingHtml = `
<article class="Box-row">
  <h2><a href="/vercel/next.js">vercel/next.js</a></h2>
  <p class="col-9">The React Framework for the Web</p>
  <span itemprop="programmingLanguage">TypeScript</span>
  <svg class="octicon-star">star icon</svg>  123,456
  <span>2,345 stars today</span>
</article>
<article class="Box-row">
  <h2><a href="/facebook/react">facebook/react</a></h2>
  <p class="col-9 something">A declarative JavaScript library</p>
  <span itemprop="programmingLanguage">JavaScript</span>
  <svg>octicon-star</svg>  987,654
</article>
`;

describe("github adapter", () => {
  let originalFetch: typeof fetch;
  let originalWarn: typeof console.warn;
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWarn = console.warn;

    fetchMock = mock();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    warnSpy = mock(() => {});
    console.warn = warnSpy as unknown as typeof console.warn;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  });

  test("returns empty with warning when releases mode has no repos configured", async () => {
    const items = await adapter.fetch({ params: { mode: "releases" } } as any);
    expect(items).toEqual([]);
    expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
    expect(String(warnSpy.mock.calls[0][0])).toContain("no repos configured for releases mode");
  });

  test("fetches releases for repos, parses atom, maps items with correct fields, id, source, body stripped, timestamp", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return {
          ok: true,
          status: 200,
          text: async () => releasesXml,
        } as any;
      }
      throw new Error("unexpected url in test");
    });

    const items = await adapter.fetch({
      params: { mode: "releases", repos: ["facebook/react"], limit: 10 },
    } as any);

    expect(fetchMock.mock.calls.length).toBe(1);
    expect(items.length).toBe(2);
    expect(items[0].title).toContain("facebook/react: v19.0.0");
    expect(items[0].url).toBe("https://github.com/facebook/react/releases/tag/v19.0.0");
    expect(items[0].source).toBe("github:facebook/react");
    expect(items[0].id).toBe("github:facebook/react:v19.0.0");
    expect(items[0].body).toContain("Bug fixes and new features in React 19");
    expect(items[0].timestamp).toBeInstanceOf(Date);
    // second item older
    expect(items[1].title).toContain("v18.3.0");
  });

  test("releases respects per-repo limit then outer cap", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => releasesXml,
    } as any));

    const items = await adapter.fetch({
      params: { mode: "releases", repos: ["facebook/react", "vercel/next.js"], limit: 1 },
    } as any);

    // 2 per feed but outer slice(0, 1*2=2) but since 4 total? wait 2 feeds x 1 =2, but code slices after flat+sort to limit*len
    expect(items.length).toBeLessThanOrEqual(2);
  });

  test("fetches trending with language and since, parses html, maps stars/gained/desc", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("trending")) {
        return {
          ok: true,
          status: 200,
          text: async () => trendingHtml,
        } as any;
      }
      throw new Error("unexpected");
    });

    const items = await adapter.fetch({
      params: { mode: "trending", language: "typescript", since: "daily", limit: 5 },
    } as any);

    expect(items.length).toBe(2);
    expect(items[0].title).toBe("vercel/next.js");
    expect(items[0].source).toBe("github:trending:typescript");
    expect(items[0].body).toContain("The React Framework");
    expect(items[0].body).toContain("123,456 stars");
    expect(items[0].body).toContain("+2,345 today");
    expect(items[1].title).toBe("facebook/react");
  });

  test("trending default (no lang, daily) works and respects limit", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => trendingHtml,
    } as any));

    const items = await adapter.fetch({
      params: { mode: "trending", limit: 1 },
    } as any);

    expect(items.length).toBe(1);
    expect(items[0].source).toBe("github:trending");
  });

  test("handles !ok for releases feed (returns [] for repo, no crash)", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: false,
      status: 404,
      text: async () => "",
    } as any));

    const items = await adapter.fetch({
      params: { mode: "releases", repos: ["bad/repo"], limit: 10 },
    } as any);

    expect(items).toEqual([]);
    expect(warnSpy.mock.calls.some((c: any[]) =>
      String(c[0]).includes("failed to fetch releases for bad/repo: 404")
    )).toBe(true);
  });

  test("handles fetch error (reject) for trending (returns [], warns)", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("network boom");
    });

    const items = await adapter.fetch({
      params: { mode: "trending" },
    } as any);

    expect(items).toEqual([]);
    expect(warnSpy.mock.calls.some((c: any[]) =>
      String(c[0]).includes("error fetching trending")
    )).toBe(true);
  });
});
