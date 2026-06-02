import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import lobstersAdapter from "./adapters/lobsters";
import type { AdapterConfig } from "./adapters/types";

interface LobstersFixture {
  short_id: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  comments_url: string;
  submitter_user: string;
  created_at: string;
  tags: string[];
}

const defaultCfg: AdapterConfig = { type: "lobsters" };

function lobstersCfg(params: Record<string, unknown> = {}): AdapterConfig {
  return { ...defaultCfg, params };
}

const makeItem = (overrides: Partial<LobstersFixture> = {}): LobstersFixture => ({
  short_id: "abc123",
  title: "Example Lobsters Post",
  url: "https://example.com/post",
  score: 42,
  comment_count: 7,
  comments_url: "https://lobste.rs/s/abc123",
  submitter_user: "alice",
  created_at: "2024-05-20T12:00:00Z",
  tags: ["programming"],
  ...overrides,
});

function makeJsonResponse(items: LobstersFixture[], status = 200): Response {
  return new Response(JSON.stringify(items), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("lobsters", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("fetches standard hottest feed with defaults and maps fields", async () => {
    const item = makeItem({ short_id: "def456", title: "Hot Post", score: 99 });
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse([item]));
    globalThis.fetch = fetchMock as typeof fetch;

    const results = await lobstersAdapter.fetch(lobstersCfg());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
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

  test("resolves feed aliases (hot/front -> hottest, new/recent -> newest)", async () => {
    const item = makeItem();
    const fetchMock = vi.fn().mockImplementation(() => makeJsonResponse([item]));
    globalThis.fetch = fetchMock as typeof fetch;

    await lobstersAdapter.fetch(lobstersCfg({ feed: "hot" }));
    await lobstersAdapter.fetch(lobstersCfg({ feed: "new" }));
    await lobstersAdapter.fetch(lobstersCfg({ feed: "active" }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://lobste.rs/active.json",
      expect.anything(),
    );
  });

  test("fetches by tags, merges results, dedupes by short_id, sets composite source, sorts by score for hottest", async () => {
    const foo = makeItem({ short_id: "foo", score: 5, tags: ["foo"] });
    const bar = makeItem({ short_id: "bar", score: 20, tags: ["bar"] });
    const dup = makeItem({ short_id: "foo", score: 10, tags: ["foo"] }); // dup short_id

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse([foo, dup]))
      .mockResolvedValueOnce(makeJsonResponse([bar]));
    globalThis.fetch = fetchMock as typeof fetch;

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ tags: ["foo", "bar"], feed: "hottest", limit: 10 }),
    );

    // called for each tag url
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/t/foo.json",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://lobste.rs/t/bar.json",
      expect.anything(),
    );
    expect(results).toHaveLength(2); // deduped foo once
    expect(results[0].id).toBe("lobsters:bar"); // higher score first
    expect(results[1].id).toBe("lobsters:foo");
    expect(results[0].source).toBe("lobsters:foo+bar");
  });

  test("sorts tag results by date for newest feed", async () => {
    const older = makeItem({ short_id: "old", created_at: "2024-01-01T00:00:00Z", score: 100 });
    const newer = makeItem({ short_id: "new", created_at: "2024-05-21T00:00:00Z", score: 1 });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse([older]))
      .mockResolvedValueOnce(makeJsonResponse([newer]));
    globalThis.fetch = fetchMock as typeof fetch;

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ tags: ["x", "y"], feed: "newest" }),
    );

    expect(results[0].id).toBe("lobsters:new"); // date desc
    expect(results[1].id).toBe("lobsters:old");
  });

  test("applies min_score filter and limit after fetch", async () => {
    const items = [
      makeItem({ short_id: "low", score: 3 }),
      makeItem({ short_id: "mid", score: 15 }),
      makeItem({ short_id: "high", score: 50 }),
    ];
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse(items));
    globalThis.fetch = fetchMock as typeof fetch;

    const results = await lobstersAdapter.fetch(
      lobstersCfg({ min_score: 10, limit: 1 }),
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("lobsters:mid"); // first qualifying after filter (order preserved, no sort for standard)
  });

  test("throws on HTTP !ok for standard feed (contract; no swallow)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeJsonResponse([], 404));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      lobstersAdapter.fetch(lobstersCfg({ feed: "newest" })),
    ).rejects.toThrow(/lobsters:.*failed to fetch newest.*404/);
  });

  test("throws on !ok for first failing tag (no partial merge on fetch error)", async () => {
    const good = makeItem({ short_id: "good", score: 10 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse([], 503))
      .mockResolvedValueOnce(makeJsonResponse([good]));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      lobstersAdapter.fetch(lobstersCfg({ tags: ["bad", "good"] })),
    ).rejects.toThrow(/lobsters:.*failed to fetch tag bad.*503/);
  });

  test("throws on network error (fetch reject) with adapter prefix", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection refused"));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      lobstersAdapter.fetch(lobstersCfg({ feed: "active" })),
    ).rejects.toThrow(/lobsters: error fetching active.*connection refused/);
  });
});