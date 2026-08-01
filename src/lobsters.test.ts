import { describe, expect, test } from "bun:test";
import lobstersAdapter, {
  lobstersSourceLabel,
  resolveLobstersFeedType,
} from "./adapters/lobsters";
import { useFetchMockSuite } from "./test/adapter-mocks";
import { lobstersCfg } from "./test/adapter-cfg";
import { makeJsonResponse } from "./test/fetch-responses";
import { invalidLimitParams, invalidMinScoreParams } from "./test/invalid-params";
import { makeLobstersItem } from "./test/lobsters-fixtures";

const mocks = useFetchMockSuite();

describe("lobstersSourceLabel", () => {
  test("joins tags when configured", () => {
    expect(lobstersSourceLabel(["rust", "linux"], "hottest")).toBe("lobsters:rust+linux");
  });

  test("uses feed type when no tags", () => {
    expect(lobstersSourceLabel([], "newest")).toBe("lobsters:newest");
  });
});

describe("resolveLobstersFeedType", () => {
  test.each([
    ["hottest", "hottest"],
    ["newest", "newest"],
    ["active", "active"],
    ["HOTTEST", "hottest"],
    ["hot", "hottest"],
    ["front", "hottest"],
    ["new", "newest"],
    ["recent", "newest"],
    ["NEWEST", "newest"],
    ["unknown-feed", "hottest"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(resolveLobstersFeedType(input)).toBe(expected);
  });
});

describe("lobsters", () => {
  test("fetches standard hottest feed with defaults and maps fields", async () => {
    const item = makeLobstersItem({ short_id: "def456", title: "Hot Post", score: 99 });
    mocks.fetchMock.mockResolvedValue(makeJsonResponse([item]));

    const results = await lobstersAdapter.fetch(lobstersCfg());

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/hottest.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "lobsters:def456",
      title: "Hot Post",
      url: "https://example.com/post",
      source: "lobsters:hottest",
      body: expect.stringContaining("99 points"),
    });
    expect(results[0].timestamp).toBeInstanceOf(Date);
  });

  test("falls back to current time for unparseable created_at instead of an Invalid Date", async () => {
    const item = makeLobstersItem({ created_at: "not-a-date" });
    mocks.fetchMock.mockResolvedValue(makeJsonResponse([item]));

    const before = Date.now();
    const results = await lobstersAdapter.fetch(lobstersCfg());

    expect(results).toHaveLength(1);
    expect(Number.isNaN(results[0].timestamp.getTime())).toBe(false);
    expect(results[0].timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      'dates: invalid feed date "not-a-date", using current time',
    );
  });

  test("blank-only feed uses default hottest", async () => {
    const item = makeLobstersItem({ short_id: "blankfeed1" });
    mocks.fetchMock.mockResolvedValue(makeJsonResponse([item]));

    await lobstersAdapter.fetch(lobstersCfg({ feed: "   " }));

    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/hottest.json",
      expect.anything(),
    );
  });

  test("trims whitespace from configured feed", async () => {
    const item = makeLobstersItem({ short_id: "trimfeed1" });
    mocks.fetchMock.mockResolvedValue(makeJsonResponse([item]));

    await lobstersAdapter.fetch(lobstersCfg({ feed: "  newest  " }));

    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/newest.json",
      expect.anything(),
    );
  });

  test("resolves feed aliases (hot/front -> hottest, new/recent -> newest)", async () => {
    const item = makeLobstersItem();
    mocks.fetchMock.mockImplementation(() => makeJsonResponse([item]));

    await lobstersAdapter.fetch(lobstersCfg({ feed: "hot" }));
    await lobstersAdapter.fetch(lobstersCfg({ feed: "new" }));
    await lobstersAdapter.fetch(lobstersCfg({ feed: "active" }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.fetchMock).toHaveBeenLastCalledWith(
      "https://lobste.rs/active.json",
      expect.anything(),
    );
  });

  test("blank-only tags behave like no tags configured", async () => {
    const item = makeLobstersItem({ short_id: "blank1" });
    mocks.fetchMock.mockResolvedValue(makeJsonResponse([item]));

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ tags: ["", "  "], feed: "hottest" }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("lobsters:hottest");
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/hottest.json",
      expect.anything(),
    );
    expect(mocks.warnSpy).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured tag names", async () => {
    const item = makeLobstersItem({ short_id: "trim1", title: "Trimmed" });
    mocks.fetchMock
      .mockResolvedValueOnce(makeJsonResponse([]))
      .mockResolvedValueOnce(makeJsonResponse([item]));

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ tags: ["  foo  ", "bar"], feed: "hottest", limit: 10 }),
    );

    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/t/foo.json",
      expect.anything(),
    );
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/t/bar.json",
      expect.anything(),
    );
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("lobsters:foo+bar");
  });

  test("fetches by tags, merges results, dedupes by short_id, sets composite source, sorts by score for hottest", async () => {
    const foo = makeLobstersItem({ short_id: "foo", score: 5, tags: ["foo"] });
    const bar = makeLobstersItem({ short_id: "bar", score: 20, tags: ["bar"] });
    const dup = makeLobstersItem({ short_id: "foo", score: 10, tags: ["foo"] }); // dup short_id

    mocks.fetchMock
      .mockResolvedValueOnce(makeJsonResponse([foo, dup]))
      .mockResolvedValueOnce(makeJsonResponse([bar]));

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ tags: ["foo", "bar"], feed: "hottest", limit: 10 }),
    );

    // called for each tag url
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/t/foo.json",
      expect.anything(),
    );
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/t/bar.json",
      expect.anything(),
    );
    expect(results).toHaveLength(2); // deduped foo once
    expect(results[0].id).toBe("lobsters:bar"); // higher score first
    expect(results[1].id).toBe("lobsters:foo");
    expect(results[0].source).toBe("lobsters:foo+bar");
  });

  test("sorts tag results by date for newest feed", async () => {
    const older = makeLobstersItem({ short_id: "old", created_at: "2024-01-01T00:00:00Z", score: 100 });
    const newer = makeLobstersItem({ short_id: "new", created_at: "2024-05-21T00:00:00Z", score: 1 });

    mocks.fetchMock
      .mockResolvedValueOnce(makeJsonResponse([older]))
      .mockResolvedValueOnce(makeJsonResponse([newer]));

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ tags: ["x", "y"], feed: "newest" }),
    );

    expect(results[0].id).toBe("lobsters:new"); // date desc
    expect(results[1].id).toBe("lobsters:old");
  });

  test("sorts tag results by comment_count for active feed", async () => {
    const quiet = makeLobstersItem({ short_id: "quiet", comment_count: 2, score: 100 });
    const busy = makeLobstersItem({ short_id: "busy", comment_count: 50, score: 1 });

    mocks.fetchMock
      .mockResolvedValueOnce(makeJsonResponse([quiet]))
      .mockResolvedValueOnce(makeJsonResponse([busy]));

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ tags: ["x", "y"], feed: "active" }),
    );

    expect(results[0].id).toBe("lobsters:busy");
    expect(results[1].id).toBe("lobsters:quiet");
  });

  test.each(invalidLimitParams(25))(
    "invalid limit (%s) uses default slice of 25",
    async (limit) => {
      const items = Array.from({ length: 30 }, (_, i) =>
        makeLobstersItem({ short_id: `id${i}`, title: `Post ${i}` }),
      );
      mocks.fetchMock.mockResolvedValue(makeJsonResponse(items));

      const results = await lobstersAdapter.fetch(lobstersCfg({ limit }));

      expect(results).toHaveLength(25);
    },
  );

  test("caps limit at 100", async () => {
    const items = Array.from({ length: 120 }, (_, i) =>
      makeLobstersItem({ short_id: `id${i}`, title: `Post ${i}` }),
    );
    mocks.fetchMock.mockResolvedValue(makeJsonResponse(items));

    const results = await lobstersAdapter.fetch(lobstersCfg({ limit: 500 }));

    expect(results).toHaveLength(100);
  });

  test("floors fractional limit", async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeLobstersItem({ short_id: `id${i}`, title: `Post ${i}` }),
    );
    mocks.fetchMock.mockResolvedValue(makeJsonResponse(items));

    const results = await lobstersAdapter.fetch(lobstersCfg({ limit: 7.9 }));

    expect(results).toHaveLength(7);
  });

  test("applies min_score filter and limit after fetch", async () => {
    const items = [
      makeLobstersItem({ short_id: "low", score: 3 }),
      makeLobstersItem({ short_id: "mid", score: 15 }),
      makeLobstersItem({ short_id: "high", score: 50 }),
    ];
    mocks.fetchMock.mockResolvedValue(makeJsonResponse(items));

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ min_score: 10, limit: 1 }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("lobsters:mid"); // first qualifying after filter (order preserved, no sort for standard)
  });

  test.each(invalidMinScoreParams(50))(
    "invalid min_score (%s) treated as 0 (no score filter)",
    async (min_score) => {
      const items = [
        makeLobstersItem({ short_id: "low", score: 3 }),
        makeLobstersItem({ short_id: "high", score: 50 }),
      ];
      mocks.fetchMock.mockResolvedValue(makeJsonResponse(items));

      const results = await lobstersAdapter.fetch(
        lobstersCfg({ min_score, limit: 10 }),
      );

      expect(results).toHaveLength(2);
    },
  );

  test("throws on HTTP !ok for standard feed (contract; no swallow)", async () => {
    mocks.fetchMock.mockResolvedValue(makeJsonResponse([], 404));

    await expect(
      lobstersAdapter.fetch(lobstersCfg({ feed: "newest" })),
    ).rejects.toThrow(/lobsters:.*failed to fetch newest.*404/);
  });

  test("tolerates partial tag failure, returns items from successful tags", async () => {
    const good = makeLobstersItem({ short_id: "good", score: 10 });
    mocks.fetchMock
      .mockResolvedValueOnce(makeJsonResponse([], 503))
      .mockResolvedValueOnce(makeJsonResponse([good]));

    const results = await lobstersAdapter.fetch(lobstersCfg({ tags: ["bad", "good"] }));
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe(good.title);
  });

  test("decodes HTML entities in item titles", async () => {
    const item = makeLobstersItem({ title: "A &amp; B &#8364; C" });
    mocks.fetchMock.mockResolvedValue(makeJsonResponse([item]));

    const results = await lobstersAdapter.fetch(lobstersCfg());
    expect(results[0].title).toBe("A & B € C");
  });

  test("throws on network error (fetch reject) with adapter prefix", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      lobstersAdapter.fetch(lobstersCfg({ feed: "active" })),
    ).rejects.toThrow(/lobsters:.*error fetching active.*connection refused/);
  });

  test("warns and returns [] when feed response is not a JSON array", async () => {
    mocks.fetchMock.mockResolvedValue(makeJsonResponse({ error: "unexpected shape" }));

    const items = await lobstersAdapter.fetch(lobstersCfg({ feed: "newest" }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "lobsters: expected JSON array for newest (got object), treating as empty",
    );
  });

  test("filters invalid item elements from standard feed response and warns", async () => {
    const valid = makeLobstersItem({ short_id: "valid1", title: "Valid Post" });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse([
        valid,
        { title: "Missing short_id", created_at: "2024-05-20T12:00:00Z", score: 1, comment_count: 0, comments_url: "https://lobste.rs/s/x", submitter_user: "bob" },
        null,
      ]),
    );

    const items = await lobstersAdapter.fetch(lobstersCfg({ feed: "hottest", limit: 5 }));

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("lobsters:valid1");
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "lobsters: skipped 2 invalid element(s) in hottest (3 total; required: short_id, title, created_at)",
    );
  });

  test("filters invalid item elements from tag response and warns", async () => {
    const valid = makeLobstersItem({ short_id: "tag-valid", title: "Tag Valid" });
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/t/rust.json")) {
        return makeJsonResponse([
          valid,
          { short_id: "bad", score: 5, comment_count: 1, comments_url: "https://lobste.rs/s/bad", submitter_user: "eve" },
        ]);
      }
      return makeJsonResponse([]);
    });

    const items = await lobstersAdapter.fetch(lobstersCfg({ tags: ["rust"], limit: 5 }));

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("lobsters:tag-valid");
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      'lobsters: skipped 1 invalid element(s) in tag rust (2 total; required: short_id, title, created_at)',
    );
  });
});

describe("lobsters degraded payloads", () => {
  test("degrades gracefully when optional item fields are missing", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse([
        {
          short_id: "bare1",
          title: "Bare Story",
          created_at: "2024-05-20T12:00:00Z",
        },
      ]),
    );

    const items = await lobstersAdapter.fetch(lobstersCfg({ feed: "hottest", limit: 5 }));

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("lobsters:bare1");
    expect(items[0].url).toBe("https://lobste.rs/s/bare1");
    expect(items[0].body).toContain("0 points");
    expect(items[0].body).not.toContain("by ");
    expect(Number.isNaN(items[0].timestamp.getTime())).toBe(false);
  });

  test("sorts hottest feed without crashing when scores are missing", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/t/rust.json")) {
        return makeJsonResponse([
          { short_id: "noscore", title: "No Score", created_at: "2024-05-21T12:00:00Z" },
          makeLobstersItem({ short_id: "scored", title: "Scored", score: 10 }),
        ]);
      }
      return makeJsonResponse([]);
    });

    const items = await lobstersAdapter.fetch(lobstersCfg({ tags: ["rust"], limit: 5 }));

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("lobsters:scored");
    expect(items[1].id).toBe("lobsters:noscore");
  });
});
