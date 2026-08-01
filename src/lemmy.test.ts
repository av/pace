import { describe, expect, test } from "bun:test";
import lemmyAdapter, { lemmySourceLabel, resolveLemmySort } from "./adapters/lemmy";
import { makeErrorResponse, makeJsonResponse } from "./test/fetch-responses";
import { invalidMinScoreParams } from "./test/invalid-params";
import { expectAdapterFetchError, fetchMockCallUrl, useFetchMockSuite } from "./test/adapter-mocks";
import { lemmyCfg } from "./test/adapter-cfg";
import { makePostListResponse, makePostView } from "./test/lemmy-fixtures";
import { spyConsole } from "./test/console-spy";

const mocks = useFetchMockSuite();


describe("lemmySourceLabel", () => {
  test("uses community path for single community", () => {
    expect(lemmySourceLabel("lemmy.world", ["rust"])).toBe("lemmy:lemmy.world:c/rust");
  });

  test("uses instance only for multiple communities", () => {
    expect(lemmySourceLabel("lemmy.world", ["rust", "linux"])).toBe("lemmy:lemmy.world");
  });
});

describe("resolveLemmySort", () => {
  test.each([
    ["hot", "Hot"],
    ["Hot", "Hot"],
    ["HOT", "Hot"],
    ["new", "New"],
    ["New", "New"],
    ["top", "Top"],
    ["Top", "Top"],
    ["active", "Active"],
    ["Active", "Active"],
    ["mostcomments", "MostComments"],
    ["MostComments", "MostComments"],
    ["most_comments", "MostComments"],
    ["comments", "MostComments"],
    ["invalid", "Hot"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(resolveLemmySort(input)).toBe(expected);
  });
});

describe("lemmy malformed post views", () => {
  test("skips malformed elements with a warn instead of failing the whole fetch", async () => {
    const valid = makePostView();
    const payload = makePostListResponse([valid]);
    // Regression: any of these previously threw (sort comparator reading
    // b.counts.score, dedupeKey reading view.post.id, buildBody reading
    // creator.name) and failed the entire lemmy fetch.
    (payload.posts as unknown[]).push(
      null,
      { post: { id: 2, name: "no counts", ap_id: "https://x/2", published: "2024-01-01T00:00:00Z" } },
      { ...valid, creator: undefined },
      "garbage",
    );
    mocks.fetchMock.mockResolvedValue(makeJsonResponse(payload));

    await spyConsole(["warn"], async ({ warn }) => {
      const items = await lemmyAdapter.fetch(lemmyCfg());
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("lemmy:lemmy.ml:1001");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("skipped 4 invalid element(s)");
    });
  });

  test("keeps a valid post with score 0", async () => {
    const zero = makePostView({ counts: { score: 0 } });
    mocks.fetchMock.mockResolvedValue(makeJsonResponse(makePostListResponse([zero])));

    await spyConsole(["warn"], async ({ warn }) => {
      const items = await lemmyAdapter.fetch(lemmyCfg());
      expect(items).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe("lemmy", () => {
  test("buildBody joins engagement helpers with community and optional discuss", async () => {
    const view = makePostView();
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([view])),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg());

    expect(items[0].body).toBe(
      "42 points | by testuser | 15 comments | c/technology | discuss: https://lemmy.ml/post/1001",
    );
  });

  test("buildBody omits discuss when URL is the ap_id (self post)", async () => {
    const selfPost = makePostView({
      post: { id: 8, url: "https://lemmy.ml/post/8", ap_id: "https://lemmy.ml/post/8" },
    });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([selfPost])),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg());

    expect(items[0].body).toBe("42 points | by testuser | 15 comments | c/technology");
    expect(items[0].body).not.toContain("discuss:");
  });

  test("parses naive Lemmy published datetimes as UTC, not host-local time", async () => {
    // Real Lemmy API payloads carry naive UTC datetimes without a zone
    // designator; a raw new Date() shifted them by the host UTC offset.
    const view = makePostView({ post: { published: "2024-03-01T12:00:00.123456" } });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([view])),
    );

    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const items = await lemmyAdapter.fetch(lemmyCfg());
      expect(items[0].timestamp.toISOString()).toBe("2024-03-01T12:00:00.123Z");
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  test("falls back to current time for unparseable published dates", async () => {
    const view = makePostView({ post: { published: "not-a-date" } });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([view])),
    );

    await spyConsole(["warn"], async ({ warn }) => {
      const before = Date.now();
      const items = await lemmyAdapter.fetch(lemmyCfg());
      expect(Number.isNaN(items[0].timestamp.getTime())).toBe(false);
      expect(items[0].timestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(warn).toHaveBeenCalledWith(
        'dates: invalid feed date "not-a-date", using current time',
      );
    });
  });

  test("decodes HTML entities in item titles from API", async () => {
    const view = makePostView({ post: { name: "A &amp; B &#8364; C" } });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([view])),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg());
    expect(items[0].title).toBe("A & B € C");
  });

  test("fetches frontpage from default instance when no communities specified", async () => {
    const view = makePostView();
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([view])),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg());

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "lemmy:lemmy.ml:1001",
      title: "Test Post Title",
      url: "https://example.com/article",
      source: "lemmy:lemmy.ml",
    });
    expect(items[0].body).toContain("42 points");
    expect(items[0].body).toContain("by testuser");
    expect(items[0].body).toContain("15 comments");
    expect(items[0].body).toContain("c/technology");

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("lemmy.ml");
    expect(calledUrl).toContain("sort=Hot");
  });

  test("treats blank-only communities as frontpage (no community_name requests)", async () => {
    const view = makePostView();
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([view])),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg({ communities: ["", "  "] }));

    expect(items).toHaveLength(1);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).not.toContain("community_name=");
    expect(calledUrl).toContain("lemmy.ml");
  });

  test("trims whitespace from configured community names", async () => {
    const view = makePostView({ community: { name: "linux" } });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([view])),
    );

    await lemmyAdapter.fetch(lemmyCfg({ communities: ["  linux  ", ""] }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("community_name=linux");
  });

  test("fetches specific communities", async () => {
    const view1 = makePostView({ post: { id: 1 }, community: { name: "linux" } });
    const view2 = makePostView({ post: { id: 2 }, community: { name: "rust" } });

    mocks.fetchMock
      .mockResolvedValueOnce(
        makeJsonResponse(makePostListResponse([view1])),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(makePostListResponse([view2])),
      );

    const items = await lemmyAdapter.fetch(lemmyCfg({ communities: ["linux", "rust"] }));

    expect(items).toHaveLength(2);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);

    const url1 = fetchMockCallUrl(mocks.fetchMock);
    expect(url1).toContain("community_name=linux");
    const url2 = fetchMockCallUrl(mocks.fetchMock, 1);
    expect(url2).toContain("community_name=rust");
  });

  test("uses custom instance", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([])),
    );

    await lemmyAdapter.fetch(lemmyCfg({ instance: "lemmy.world", communities: ["test"] }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("lemmy.world");
  });

  test("treats blank-only instance as default lemmy.ml", async () => {
    const view = makePostView();
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([view])),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg({ instance: "   " }));

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("lemmy:lemmy.ml:1001");
    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("lemmy.ml");
  });

  test("trims whitespace from configured instance", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([])),
    );

    await lemmyAdapter.fetch(
      lemmyCfg({ instance: "  lemmy.world  ", communities: ["test"] }),
    );

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("lemmy.world");
    expect(calledUrl).not.toContain("lemmy.world%20");
  });

  test("applies sort parameter (case-insensitive)", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([])),
    );

    await lemmyAdapter.fetch(lemmyCfg({ sort: "new" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("sort=New");
  });

  test("defaults invalid sort to Hot", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([])),
    );

    await lemmyAdapter.fetch(lemmyCfg({ sort: "invalid" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("sort=Hot");
  });

  test("resolves sort aliases (most_comments -> MostComments)", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([])),
    );

    await lemmyAdapter.fetch(lemmyCfg({ sort: "most_comments" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("sort=MostComments");
  });

  test("applies min_score filter", async () => {
    const posts = [
      makePostView({ post: { id: 1 }, counts: { score: 5 } }),
      makePostView({ post: { id: 2 }, counts: { score: 100 } }),
      makePostView({ post: { id: 3 }, counts: { score: 20 } }),
    ];
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse(posts)),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg({ min_score: 10 }));

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("lemmy:lemmy.ml:2");
    expect(items[1].id).toBe("lemmy:lemmy.ml:3");
  });

  test.each(invalidMinScoreParams(10))(
    "invalid min_score (%s) treated as 0 (no score filter)",
    async (min_score) => {
      const posts = [
        makePostView({ post: { id: 1 }, counts: { score: 5 } }),
        makePostView({ post: { id: 2 }, counts: { score: 100 } }),
      ];
      mocks.fetchMock.mockResolvedValue(
        makeJsonResponse(makePostListResponse(posts)),
      );

      const items = await lemmyAdapter.fetch(lemmyCfg({ min_score }));

      expect(items).toHaveLength(2);
    },
  );

  test("applies limit after filtering", async () => {
    const posts = Array.from({ length: 10 }, (_, i) =>
      makePostView({ post: { id: i + 1 }, counts: { score: 100 - i * 10 } }),
    );
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse(posts)),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg({ limit: 3 }));

    expect(items).toHaveLength(3);
  });

  test("deduplicates posts by ID across communities", async () => {
    const samePost = makePostView({ post: { id: 999 } });

    mocks.fetchMock
      .mockResolvedValueOnce(
        makeJsonResponse(makePostListResponse([samePost])),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(makePostListResponse([samePost])),
      );

    const items = await lemmyAdapter.fetch(lemmyCfg({ communities: ["linux", "opensource"] }));

    expect(items).toHaveLength(1);
  });

  test("uses ap_id as URL for self posts (no external URL)", async () => {
    const selfPost = makePostView({
      post: { id: 5, url: undefined, ap_id: "https://lemmy.ml/post/5" },
    });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([selfPost])),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg());

    expect(items[0].url).toBe("https://lemmy.ml/post/5");
  });

  test("includes discuss link for external URLs", async () => {
    const linkPost = makePostView({
      post: { id: 7, url: "https://example.com/article", ap_id: "https://lemmy.ml/post/7" },
    });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([linkPost])),
    );

    const items = await lemmyAdapter.fetch(lemmyCfg());

    expect(items[0].body).toContain("discuss: https://lemmy.ml/post/7");
  });

  test("sets source label for single community", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makePostListResponse([makePostView()])),
    );

    const items = await lemmyAdapter.fetch(
      lemmyCfg({ communities: ["technology"], instance: "lemmy.world" }),
    );

    expect(items[0].source).toBe("lemmy:lemmy.world:c/technology");
  });

  test("throws on HTTP error with adapter prefix", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(500));

    await expect(lemmyAdapter.fetch(lemmyCfg())).rejects.toThrow("lemmy:");
  });

  test("throws on network error with adapter prefix", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(lemmyAdapter.fetch(lemmyCfg())).rejects.toThrow("lemmy:");
  });

  test("errorMessage on !ok and network", async () => {
    await expectAdapterFetchError(
      mocks.fetchMock,
      [
        {
          httpStatus: 500,
          fetch: () => lemmyAdapter.fetch(lemmyCfg()),
          throwMatcher: "lemmy:",
        },
        {
          networkError: new Error("connection refused"),
          fetch: () => lemmyAdapter.fetch(lemmyCfg()),
          throwMatcher: "lemmy:",
        },
      ],
      { clearBetweenCases: false, spy: { times: 3 } },
    );
  });

  test("warns and returns [] when post list response omits posts field", async () => {
    mocks.fetchMock.mockResolvedValue(makeJsonResponse({}));

    const items = await lemmyAdapter.fetch(lemmyCfg());

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "lemmy: expected JSON object for lemmy.ml frontpage (missing required field(s): posts), treating as null",
    );
  });

  test("warns and returns [] when post list response is not an object", async () => {
    mocks.fetchMock.mockResolvedValue(makeJsonResponse("broken"));

    const items = await lemmyAdapter.fetch(lemmyCfg());

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "lemmy: expected JSON object for lemmy.ml frontpage (got string), treating as null",
    );
  });
});