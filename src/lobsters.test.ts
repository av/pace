import { describe, expect, test } from "bun:test";
import lobstersAdapter, { resolveLobstersFeedType } from "./adapters/lobsters";
import { useFetchMockSuite } from "./test/adapter-mocks";
import { lobstersCfg } from "./test/adapter-cfg";
import { makeJsonResponse } from "./test/fetch-responses";
import { invalidLimitParams, invalidMinScoreParams } from "./test/invalid-params";
import { makeLobstersItem } from "./test/lobsters-fixtures";

const mocks = useFetchMockSuite();

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

  test("throws on !ok for first failing tag (no partial merge on fetch error)", async () => {
    const good = makeLobstersItem({ short_id: "good", score: 10 });
    mocks.fetchMock
      .mockResolvedValueOnce(makeJsonResponse([], 503))
      .mockResolvedValueOnce(makeJsonResponse([good]));

    await expect(
      lobstersAdapter.fetch(lobstersCfg({ tags: ["bad", "good"] })),
    ).rejects.toThrow(/lobsters:.*failed to fetch tag bad.*503/);
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
});