import { describe, test, expect } from "bun:test";
import adapter, { resolveGitHubMode, resolveGitHubPeriod } from "./adapters/github";
import { FEED_XML_ACCEPT } from "./adapters/fetch";
import {
  expectAdapterFetchError,
  fetchMockCallUrl,
  fetchMockCalls,
  useFetchMockSuite,
} from "./test/adapter-mocks";
import { githubCfg } from "./test/adapter-cfg";
import { makeErrorResponse, makeJsonResponse, makeTextResponse } from "./test/fetch-responses";
import {
  githubReleasesAtomFeedFixture,
  githubReleasesEntityEntryTitleFixture,
  githubReleasesEntityFeedTitleFixture,
  githubReleasesEncodedTagFixture,
  githubReleasesHtmlBodyFixture,
  githubTrendingEntityHtmlFixture,
  githubTrendingHtmlFixture,
  githubTrendingSingularStarHtmlFixture,
} from "./test/github-fixtures";

const mocks = useFetchMockSuite();

const githubFetchCalls = () => fetchMockCalls(mocks.fetchMock);


describe("resolveGitHubMode", () => {
  test.each([
    ["trending", "trending"],
    ["releases", "releases"],
    ["release", "releases"],
    ["TRENDING", "trending"],
    ["invalid", "releases"],
    ["", "releases"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(resolveGitHubMode(input)).toBe(expected);
  });
});

describe("resolveGitHubPeriod", () => {
  test.each([
    ["daily", "daily"],
    ["weekly", "weekly"],
    ["monthly", "monthly"],
    ["DAILY", "daily"],
    ["day", "daily"],
    ["today", "daily"],
    ["1d", "daily"],
    ["24h", "daily"],
    ["week", "weekly"],
    ["7d", "weekly"],
    ["month", "monthly"],
    ["30d", "monthly"],
    ["invalid", "daily"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(resolveGitHubPeriod(input)).toBe(expected);
  });
});

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
        return makeTextResponse(githubReleasesAtomFeedFixture());
      }
      if (String(url).includes("api.github.com/repos/")) {
        return makeJsonResponse({ description: "" });
      }
      throw new Error("unexpected url in test");
    });

    await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["  facebook/react  ", ""], limit: 10 }),
    );

    const atomCalls = githubFetchCalls().filter((c) => c.url.includes("releases.atom"));
    expect(atomCalls.length).toBe(1);
    expect(atomCalls[0].url).toBe("https://github.com/facebook/react/releases.atom");
  });

  test("sends FEED_XML_ACCEPT when fetching releases.atom", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesAtomFeedFixture());
      }
      if (String(url).includes("api.github.com/repos/")) {
        return makeJsonResponse({ description: "" });
      }
      throw new Error("unexpected url in test");
    });

    await adapter.fetch(githubCfg({ mode: "releases", repos: ["facebook/react"] }));

    const atomCall = githubFetchCalls().find((c) => c.url.includes("releases.atom"));
    expect(atomCall).toBeDefined();
    const headers = (atomCall!.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Accept).toBe(FEED_XML_ACCEPT);
  });

  test("blank-only mode uses default releases", async () => {
    const items = await adapter.fetch(githubCfg({ mode: "   " }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("github: no repos configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("unknown mode falls back to releases pipeline", async () => {
    const items = await adapter.fetch(githubCfg({ mode: "invalid-mode" }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("github: no repos configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured mode", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("trending")) {
        return makeTextResponse(githubTrendingHtmlFixture());
      }
      throw new Error("unexpected url in test");
    });

    const items = await adapter.fetch(githubCfg({ mode: "  trending  ", limit: 1 }));

    expect(items.length).toBe(1);
    expect(fetchMockCallUrl(mocks.fetchMock)).toContain("/trending?");
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
        return makeTextResponse(githubReleasesAtomFeedFixture());
      }
      if (String(url).includes("api.github.com/repos/")) {
        return makeJsonResponse({ description: "" });
      }
      throw new Error("unexpected url in test");
    });

    await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react"], token: "  " }),
    );

    const metaCalls = githubFetchCalls().filter((c) => c.url.includes("api.github.com"));
    expect(metaCalls.length).toBe(1);
    const headers = (metaCalls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  test("trims configured token for repo meta Authorization header", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesAtomFeedFixture());
      }
      if (String(url).includes("api.github.com/repos/")) {
        return makeJsonResponse({ description: "" });
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

    const metaCalls = githubFetchCalls().filter((c) => c.url.includes("api.github.com"));
    expect(metaCalls.length).toBe(1);
    const headers = (metaCalls[0].init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_test");
  });

  test("fetches releases for repos, parses atom, maps items with correct fields, id, source, body stripped, timestamp", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesAtomFeedFixture());
      }
      if (String(url).includes("api.github.com/repos/")) {
        return makeJsonResponse({
          description: "The library for web and native user interfaces",
        });
      }
      throw new Error("unexpected url in test");
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react"], limit: 10 }),
    );

    expect(githubFetchCalls().length).toBe(2);
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

  test("decodes percent-encoded release tags from atom links for id/title", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesEncodedTagFixture());
      }
      return makeErrorResponse(404);
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["acme/pkg"], limit: 10 }),
    );

    expect(items.length).toBe(2);
    expect(items[0].id).toBe("github:acme/pkg:release/2024 beta");
    expect(items[0].title).toContain("acme/pkg: release/2024 beta");
    expect(items[0].title).not.toContain("%2F");
    expect(items[0].url).toBe(
      "https://github.com/acme/pkg/releases/tag/release%2F2024%20beta",
    );
    // Malformed percent-escapes keep the raw tag rather than throwing.
    expect(items[1].id).toBe("github:acme/pkg:v%ZZbad");
  });

  test("releases respects per-repo limit then outer cap", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("api.github.com/repos/")) {
        return makeJsonResponse({ description: "" });
      }
      return makeTextResponse(githubReleasesAtomFeedFixture());
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react", "vercel/next.js"], limit: 1 }),
    );

    expect(items.length).toBeLessThanOrEqual(2);
  });

  test("decodes HTML entities in releases atom feed title for source", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesEntityFeedTitleFixture());
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
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesEntityEntryTitleFixture());
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
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesHtmlBodyFixture());
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

  test("warns and omits tagline when repo meta response is not a JSON object", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesAtomFeedFixture());
      }
      if (String(url).includes("api.github.com/repos/")) {
        return makeJsonResponse(["unexpected", "array"]);
      }
      throw new Error("unexpected url in test");
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react"], limit: 10 }),
    );

    expect(items.length).toBe(2);
    expect(items[0].title).toContain("facebook/react: v19.0.0");
    expect(items[0].title).not.toContain("The library");
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "github: expected JSON object for facebook/react (got array), treating as null",
    );
  });

  test("releases without repo meta still return items when api.github.com fails", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("releases.atom")) {
        return makeTextResponse(githubReleasesAtomFeedFixture());
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
        return makeTextResponse(githubReleasesAtomFeedFixture());
      }
      if (String(url).includes("api.github.com/repos/")) {
        return makeJsonResponse({ description: "React" });
      }
      throw new Error("unexpected");
    });

    const items = await adapter.fetch(
      githubCfg({ mode: "releases", repos: ["facebook/react", "facebook/react"], limit: 10 }),
    );

    expect(githubFetchCalls().length).toBe(4);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.url)).toEqual([
      "https://github.com/facebook/react/releases/tag/v19.0.0",
      "https://github.com/facebook/react/releases/tag/v18.3.0",
    ]);
  });

  test("fetches trending with language and since, parses html, maps stars/gained/desc", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("trending")) {
        return makeTextResponse(githubTrendingHtmlFixture());
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

  test("parses singular '1 star today' as starsGained=1", async () => {
    mocks.fetchMock.mockImplementation(async () =>
      makeTextResponse(githubTrendingSingularStarHtmlFixture()),
    );

    const items = await adapter.fetch(githubCfg({ mode: "trending", limit: 5 }));

    expect(items.length).toBe(1);
    expect(items[0].title).toContain("solo/gem");
    expect(items[0].title).toContain("+1 today");
  });

  test("decodes HTML entities in trending repo name/title", async () => {
    mocks.fetchMock.mockImplementation(async () =>
      makeTextResponse(githubTrendingEntityHtmlFixture()),
    );

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
    mocks.fetchMock.mockImplementation(async () => makeTextResponse(githubTrendingHtmlFixture()));

    const items = await adapter.fetch(githubCfg({ mode: "trending", limit: 1 }));

    expect(items.length).toBe(1);
    expect(items[0].source).toBe("github:trending");
  });

  test("trims whitespace from configured trending language", async () => {
    mocks.fetchMock.mockImplementation(async () => makeTextResponse(githubTrendingHtmlFixture()));

    await adapter.fetch(
      githubCfg({ mode: "trending", language: "  typescript  ", limit: 1 }),
    );

    const url = fetchMockCallUrl(mocks.fetchMock);
    expect(url).toContain("/trending/typescript?");
    expect(url).toContain("since=daily");
  });

  test("whitespace-only trending language omits language path", async () => {
    mocks.fetchMock.mockImplementation(async () => makeTextResponse(githubTrendingHtmlFixture()));

    const items = await adapter.fetch(
      githubCfg({ mode: "trending", language: "   ", limit: 1 }),
    );

    const url = fetchMockCallUrl(mocks.fetchMock);
    expect(url).toContain("/trending?");
    expect(url).not.toMatch(/\/trending\/[^?]/);
    expect(items[0].source).toBe("github:trending");
  });

  test("trims whitespace from configured since", async () => {
    mocks.fetchMock.mockImplementation(async () => makeTextResponse(githubTrendingHtmlFixture()));

    await adapter.fetch(
      githubCfg({ mode: "trending", since: "  weekly  ", limit: 1 }),
    );

    const url = fetchMockCallUrl(mocks.fetchMock);
    expect(url).toContain("since=weekly");
  });

  test("whitespace-only since defaults to daily", async () => {
    mocks.fetchMock.mockImplementation(async () => makeTextResponse(githubTrendingHtmlFixture()));

    await adapter.fetch(githubCfg({ mode: "trending", since: "   ", limit: 1 }));

    const url = fetchMockCallUrl(mocks.fetchMock);
    expect(url).toContain("since=daily");
  });

  test("invalid since defaults to daily", async () => {
    mocks.fetchMock.mockImplementation(async () => makeTextResponse(githubTrendingHtmlFixture()));

    await adapter.fetch(
      githubCfg({ mode: "trending", since: "INVALID", limit: 1 }),
    );

    const url = fetchMockCallUrl(mocks.fetchMock);
    expect(url).toContain("since=daily");
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
    await expectAdapterFetchError(
      mocks.fetchMock,
      [
        {
          setupFetch: (fetchMock) => {
            fetchMock.mockImplementation(async () => makeErrorResponse(404));
          },
          fetch: () =>
            adapter.fetch(githubCfg({ mode: "releases", repos: ["bad/repo"], limit: 10 })),
          throwMatcher: /github:/,
        },
        {
          setupFetch: (fetchMock) => {
            fetchMock.mockImplementation(async () => {
              throw new Error("network boom");
            });
          },
          fetch: () => adapter.fetch(githubCfg({ mode: "trending" })),
          throwMatcher: /github: error fetching trending/,
        },
      ],
      { clearBetweenCases: false, spy: { times: 1 } },
    );
  });
});