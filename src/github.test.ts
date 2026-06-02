import { describe, test, expect, spyOn } from "bun:test";
import adapter from "./adapters/github";
import * as typesMod from "./adapters/types";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const githubCfg = (params: Record<string, unknown> = {}) => adapterCfg("github", params);

function makeTextResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function makeErrorResponse(status: number): Response {
  return new Response("", { status });
}

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
  <h2><a href="/owner/html-demo">owner/html-demo</a></h2>
  <p class="col-9 color-fg-muted"><a href="/owner/html-demo">Tools &amp; &#39;kit&#39; for &#x42;uilders</a></p>
  <span itemprop="programmingLanguage">Rust</span>
  <svg class="octicon-star">star</svg>  1,000
</article>
<article class="Box-row">
  <h2><a href="/facebook/react">facebook/react</a></h2>
  <p class="col-9 something">A declarative JavaScript library</p>
  <span itemprop="programmingLanguage">JavaScript</span>
  <svg>octicon-star</svg>  987,654
</article>
`;

describe("github", () => {
  test("returns empty with warning when releases mode has no repos configured", async () => {
    const items = await adapter.fetch(githubCfg({ mode: "releases" }));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("github: no repos configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("returns empty with warning when releases repos are only blank strings", async () => {
    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["", "  "] }),
    );
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("github: no repos configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured owner/repo strings in releases mode", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(releasesXml);
      }
      if (String(url).includes("api.github.com/repos/")) {
        return new Response(JSON.stringify({ description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("unexpected url in test");
    });

    await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["  facebook/react  ", ""], limit: 10 }),
    );

    const atomCalls = mocks.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("releases.atom"),
    );
    expect(atomCalls.length).toBe(1);
    expect(String(atomCalls[0][0])).toBe(
      "https://github.com/facebook/react/releases.atom",
    );
  });

  test("blank-only mode uses default releases", async () => {
    const items = await adapter.fetch(githubCfg({ mode: "   " }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("github: no repos configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured mode", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("trending")) {
        return makeTextResponse(trendingHtml);
      }
      throw new Error("unexpected url in test");
    });

    const items = await adapter.fetch(githubCfg({ mode: "  trending  ", limit: 1 }));

    expect(items.length).toBe(1);
    expect(String(mocks.fetchMock.mock.calls[0][0])).toContain("/trending?");
  });

  test("warns and returns [] when trending page has no parseable repos", async () => {
    mocks.fetchMock.mockImplementation(async () => makeTextResponse("<html></html>"));

    const items = await adapter.fetch(githubCfg({ mode: "trending", limit: 5 }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("github: no repos found on trending page");
  });

  test("omits Authorization on repo meta when token is whitespace-only", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(releasesXml);
      }
      if (String(url).includes("api.github.com/repos/")) {
        return new Response(JSON.stringify({ description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("unexpected url in test");
    });

    await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react"], token: "  " }),
    );

    const metaCalls = mocks.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.github.com"),
    );
    expect(metaCalls.length).toBe(1);
    const headers = (metaCalls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  test("trims configured token for repo meta Authorization header", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(releasesXml);
      }
      if (String(url).includes("api.github.com/repos/")) {
        return new Response(JSON.stringify({ description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("unexpected url in test");
    });

    await adapter.fetch(
      githubCfg({
        mode: "releases",
        repos: ["facebook/react"],
        token: "  ghp_test  ",
      }),
    );

    const metaCalls = mocks.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.github.com"),
    );
    expect(metaCalls.length).toBe(1);
    const headers = (metaCalls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_test");
  });

  test("fetches releases for repos, parses atom, maps items with correct fields, id, source, body stripped, timestamp", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(releasesXml);
      }
      if (String(url).includes("api.github.com/repos/")) {
        return new Response(
          JSON.stringify({ description: "The library for web and native user interfaces" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error("unexpected url in test");
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react"], limit: 10 }),
    );

    expect(mocks.fetchMock.mock.calls.length).toBe(2);
    expect(items.length).toBe(2);
    expect(items[0].title).toContain("facebook/react: v19.0.0");
    expect(items[0].title).toContain("The library for web and native user interfaces");
    expect(items[0].url).toBe("https://github.com/facebook/react/releases/tag/v19.0.0");
    expect(items[0].source).toBe("github:facebook/react");
    expect(items[0].id).toBe("github:facebook/react:v19.0.0");
    expect(items[0].body).toContain("Bug fixes and new features in React 19");
    expect(items[0].body).not.toContain("The library for web");
    expect(items[0].timestamp).toBeInstanceOf(Date);
    expect(items[1].title).toContain("v18.3.0");
  });

  test("releases respects per-repo limit then outer cap", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("api.github.com/repos/")) {
        return new Response(JSON.stringify({ description: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return makeTextResponse(releasesXml);
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react", "vercel/next.js"], limit: 1 }),
    );

    expect(items.length).toBeLessThanOrEqual(2);
  });

  test("decodes HTML entities in releases atom feed title for source", async () => {
    const entityFeedTitleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release &amp; Notes &#8364;</title>
  <entry>
    <title>v1.0.0</title>
    <link rel="alternate" type="text/html" href="https://github.com/acme/pkg/releases/tag/v1.0.0"/>
    <updated>2024-12-01T12:00:00Z</updated>
  </entry>
</feed>`;
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(entityFeedTitleXml);
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["acme/pkg"], limit: 10 }),
    );

    expect(items.length).toBe(1);
    expect(items[0].source).toBe("github:Release & Notes €");
    expect(items[0].source).not.toContain("&amp;");
    expect(items[0].source).not.toContain("&#8364;");
  });

  test("decodes HTML entities in releases atom entry title", async () => {
    const entityTitleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Rock &amp; Roll &#8364;</title>
    <link rel="alternate" type="text/html" href="https://github.com/acme/pkg/releases/tag/v1.0.0"/>
    <updated>2024-12-01T12:00:00Z</updated>
  </entry>
</feed>`;
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(entityTitleXml);
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["acme/pkg"], limit: 10 }),
    );

    expect(items.length).toBe(1);
    expect(items[0].title).toContain("Rock & Roll €");
    expect(items[0].title).not.toContain("&amp;");
    expect(items[0].title).not.toContain("&#8364;");
  });

  test("releases atom body uses FEED_BODY_STRIP_OPTIONS (tags, links, entities)", async () => {
    const htmlReleaseXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>v1.0.0</title>
    <link rel="alternate" type="text/html" href="https://github.com/acme/pkg/releases/tag/v1.0.0"/>
    <updated>2024-12-01T12:00:00Z</updated>
    <content type="html">&lt;p&gt;See &lt;a href="https://docs.example.com"&gt;docs&lt;/a&gt; for &#65; details&lt;/p&gt;</content>
  </entry>
</feed>`;
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(htmlReleaseXml);
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["acme/pkg"], limit: 10 }),
    );

    expect(items.length).toBe(1);
    expect(items[0].body).toBe("See docs for A details");
    expect(items[0].body).not.toContain("<");
    expect(items[0].body).not.toContain("docs.example.com");
  });

  test("releases without repo meta still return items when api.github.com fails", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(releasesXml);
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react"], limit: 10 }),
    );

    expect(items.length).toBe(2);
    expect(items[0].body).toContain("Bug fixes and new features in React 19");
    expect(items[0].body).not.toContain(" | The library");
  });

  test("dedupes duplicate release urls when the same repo is listed twice", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(releasesXml);
      }
      if (String(url).includes("api.github.com/repos/")) {
        return new Response(JSON.stringify({ description: "React" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("unexpected");
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react", "facebook/react"], limit: 10 }),
    );

    expect(mocks.fetchMock.mock.calls.length).toBe(4);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.url)).toEqual([
      "https://github.com/facebook/react/releases/tag/v19.0.0",
      "https://github.com/facebook/react/releases/tag/v18.3.0",
    ]);
  });

  test("fetches trending with language and since, parses html, maps stars/gained/desc", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("trending")) {
        return makeTextResponse(trendingHtml);
      }
      throw new Error("unexpected");
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "trending", language: "typescript", since: "daily", limit: 5 }),
    );

    expect(items.length).toBe(3);
    expect(items[0].title).toContain("vercel/next.js");
    expect(items[0].title).toContain("The React Framework");
    expect(items[0].title).toContain("+2,345 today");
    expect(items[0].source).toBe("github:trending:typescript");
    expect(items[0].body).toContain("123,456 stars");
    expect(items[1].title).toContain("owner/html-demo");
    expect(items[1].title).toContain("Tools & 'kit' for Builders");
    expect(items[2].title).toContain("facebook/react");
    expect(items[2].title).toContain("declarative JavaScript");
  });

  test("decodes HTML entities in trending repo name/title", async () => {
    const entityTrendingHtml = `
<article class="Box-row">
  <h2><a href="/acme/lib&amp;tools">acme / lib&amp;tools</a></h2>
  <p class="col-9">A &amp; &#8364; toolkit</p>
  <span itemprop="programmingLanguage">TypeScript</span>
  <svg class="octicon-star">star</svg>  500
</article>`;
    mocks.fetchMock.mockImplementation(async () => makeTextResponse(entityTrendingHtml));

    const items = await adapter.fetch(githubCfg({ mode: "trending", limit: 5 }));

    expect(items.length).toBe(1);
    expect(items[0].title).toContain("acme/lib&tools");
    expect(items[0].title).toContain("A & € toolkit");
    expect(items[0].title).not.toContain("&amp;");
    expect(items[0].title).not.toContain("&#8364;");
    expect(items[0].id).toBe("github:trending:acme/lib&tools:daily");
    expect(items[0].url).toBe("https://github.com/acme/lib&tools");
  });

  test("trending default (no lang, daily) works and respects limit", async () => {
    mocks.fetchMock.mockImplementation(async () => makeTextResponse(trendingHtml));

    const items = await adapter.fetch(githubCfg({ mode: "trending", limit: 1 }));

    expect(items.length).toBe(1);
    expect(items[0].source).toBe("github:trending");
  });

  test("throws on !ok for releases feed (contract; no swallow)", async () => {
    mocks.fetchMock.mockImplementation(async () => makeErrorResponse(404));

    await expect(
      adapter.fetch(githubCfg({ mode: "releases", repos: ["bad/repo"], limit: 10 })),
    ).rejects.toThrow(/github:.*failed to fetch releases for bad\/repo.*404/);
  });

  test("throws on fetch error (reject) for trending (contract; no swallow)", async () => {
    mocks.fetchMock.mockImplementation(async () => {
      throw new Error("network boom");
    });

    await expect(adapter.fetch(githubCfg({ mode: "trending" }))).rejects.toThrow(
      /github: error fetching trending.*network boom/,
    );
  });

  test("errorMessage on !ok and network", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      mocks.fetchMock.mockImplementation(async () => makeErrorResponse(404));

      await expect(
        adapter.fetch(githubCfg({ mode: "releases", repos: ["bad/repo"], limit: 10 })),
      ).rejects.toThrow(/github:/);
      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 404" });

      mocks.fetchMock.mockImplementation(async () => {
        throw new Error("network boom");
      });

      await expect(adapter.fetch(githubCfg({ mode: "trending" }))).rejects.toThrow(
        /github: error fetching trending/,
      );
      expect(emSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      emSpy.mockRestore();
    }
  });
});