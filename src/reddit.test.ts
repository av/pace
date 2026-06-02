import { describe, test, expect, spyOn } from "bun:test";
import redditAdapter from "./adapters/reddit";
import * as typesMod from "./adapters/types";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const redditCfg = (params: Record<string, unknown> = {}) => adapterCfg("reddit", params);

interface RedditPostDataFixture {
  id: string;
  title: string;
  permalink: string;
  url: string;
  selftext: string;
  is_self: boolean;
  created_utc: number;
  subreddit: string;
  score: number;
  num_comments: number;
  author: string;
}

function makePost(id: string, title = "Test Post", isSelf = false, score = 100, sub = "test"): RedditPostDataFixture {
  return {
    id,
    title,
    permalink: `/r/${sub}/comments/${id}/test_post/`,
    url: isSelf ? "" : `https://example.com/link-${id}`,
    selftext: isSelf ? "self text here" : "",
    is_self: isSelf,
    created_utc: 1716200000 + parseInt(id, 36),
    subreddit: sub,
    score,
    num_comments: 10,
    author: "tester",
  };
}

function makeListingResponse(posts: RedditPostDataFixture[]): Response {
  const children = posts.map((p) => ({ data: p }));
  return new Response(
    JSON.stringify({ data: { children } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function makeErrorResponse(status: number): Response {
  return new Response(null, { status, headers: { "content-type": "application/json" } });
}

describe("reddit", () => {
  test("ngb contract", () => {
    expect(redditAdapter.name).toBe("reddit");
    expect(typeof redditAdapter.fetch).toBe("function");
  });

  test("returns [] and warns when no subreddits configured", async () => {
    const items = await redditAdapter.fetch(redditCfg());
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("reddit: no subreddits configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("returns [] and warns when subreddits are only blank strings", async () => {
    const items = await redditAdapter.fetch(
      redditCfg({ subreddits: ["", "  "] }),
    );
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("reddit: no subreddits configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured subreddit names", async () => {
    const posts = [makePost("trim1", "Trimmed", false, 10, "programming")];
    mocks.fetchMock.mockResolvedValue(makeListingResponse(posts));

    const items = await redditAdapter.fetch(
      redditCfg({ subreddits: ["  programming  ", ""] }),
    );

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = mocks.fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/r/programming/hot.json");
    expect(items[0].source).toBe("reddit:r/programming");
  });

  test("decodes HTML entities in post titles from API", async () => {
    const posts = [makePost("ent1", "A &amp; B &#8364; C")];
    mocks.fetchMock.mockResolvedValue(makeListingResponse(posts));

    const items = await redditAdapter.fetch(redditCfg({ subreddits: ["test"] }));

    expect(items[0].title).toBe("A & B € C");
  });

  test("fetches default hot feed for a subreddit and maps items with correct source/body/url", async () => {
    const posts = [makePost("abc123", "Hello Reddit", false, 42, "programming")];
    mocks.fetchMock.mockResolvedValue(makeListingResponse(posts));

    const items = await redditAdapter.fetch(redditCfg({ subreddits: ["programming"] }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = (mocks.fetchMock.mock.calls[0][0] as string);
    expect(calledUrl).toContain("/r/programming/hot.json?limit=25&raw_json=1");
    expect(calledUrl).not.toContain("&t=");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "reddit:abc123",
      title: "Hello Reddit",
      url: "https://example.com/link-abc123",
      source: "reddit:r/programming",
      body: expect.stringContaining("42 points | by tester | 10 comments | r/programming | discuss:"),
    });
    expect(items[0].timestamp instanceof Date).toBe(true);
  });

  test("uses provided sort, limit, min_score and filters/sorts by score", async () => {
    const posts = [
      makePost("low", "Low", false, 5),
      makePost("high", "High", false, 200),
      makePost("med", "Med", false, 50),
    ];
    mocks.fetchMock.mockResolvedValue(makeListingResponse(posts));

    const items = await redditAdapter.fetch(
      redditCfg({ subreddits: ["test"], sort: "new", limit: 10, min_score: 10 }),
    );

    const calledUrl = (mocks.fetchMock.mock.calls[0][0] as string);
    expect(calledUrl).toContain("/r/test/new.json?limit=10&raw_json=1");

    // minScore 10 drops the 5, keeps 200+50, sorted desc
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("High");
    expect(items[1].title).toBe("Med");
  });

  test("defaults invalid sort and timePeriod to hot/day and omits t param unless top", async () => {
    const posts = [makePost("1")];
    mocks.fetchMock.mockResolvedValue(makeListingResponse(posts));

    await redditAdapter.fetch(redditCfg({ subreddits: ["x"], sort: "INVALID", time: "nonsense" }));

    const url = (mocks.fetchMock.mock.calls[0][0] as string);
    expect(url).toContain("/hot.json?limit=25&raw_json=1");
    expect(url).not.toContain("&t=");
  });

  test("includes t= param only for top sort with valid period", async () => {
    const posts = [makePost("top1")];
    mocks.fetchMock.mockResolvedValue(makeListingResponse(posts));

    await redditAdapter.fetch(redditCfg({ subreddits: ["x"], sort: "top", time: "week" }));

    const url = (mocks.fetchMock.mock.calls[0][0] as string);
    expect(url).toContain("/top.json?limit=25&raw_json=1&t=week");
  });

  test("merges and deduplicates posts across multiple subreddits (including multireddit + syntax)", async () => {
    const postA = makePost("dup", "Dup", false, 10, "a");
    const postB = makePost("unique", "Unique", false, 20, "b");
    // first call (a) returns both, second (b) returns dup + unique? but dedup on id
    mocks.fetchMock
      .mockResolvedValueOnce(makeListingResponse([postA, postB]))
      .mockResolvedValueOnce(makeListingResponse([postA]));

    const items = await redditAdapter.fetch(redditCfg({ subreddits: ["a", "b"] }));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    // deduped to 2 unique ids
    expect(items).toHaveLength(2);
    const ids = items.map((i) => i.id);
    expect(ids).toContain("reddit:dup");
    expect(ids).toContain("reddit:unique");
  });

  test("uses subreddit-specific source label only for single sub, else falls back to sort label", async () => {
    mocks.fetchMock.mockImplementation(async () => makeListingResponse([makePost("1")]));

    const single = await redditAdapter.fetch(redditCfg({ subreddits: ["onlyone"] }));
    expect(single[0].source).toBe("reddit:r/onlyone");

    const multi = await redditAdapter.fetch(redditCfg({ subreddits: ["one", "two"] }));
    expect(multi[0].source).toBe("reddit:hot");
  });

  test("constructs discuss link for external posts and direct url for self posts", async () => {
    const linkPost = makePost("link", "LinkPost", false, 100, "mix");
    const selfPost = makePost("self", "SelfPost", true, 100, "mix");
    mocks.fetchMock.mockImplementation(async () => makeListingResponse([linkPost, selfPost]));

    const items = await redditAdapter.fetch(redditCfg({ subreddits: ["mix"] }));

    expect(items[0].url).toContain("https://example.com/link-link"); // external
    expect(items[1].url).toContain("https://reddit.com/r/mix/comments/self/"); // discuss for self
    expect(items[1].body).not.toContain("discuss:");
  });

  test("throws reddit: failed to fetch on HTTP !ok (no double-wrap)", async () => {
    mocks.fetchMock.mockImplementation(async () => makeErrorResponse(403));

    await expect(redditAdapter.fetch(redditCfg({ subreddits: ["private"] }))).rejects.toThrow(
      /reddit: failed to fetch \/r\/private\/hot: HTTP error 403/,
    );
  });

  test("throws with exact 'reddit: error fetching' prefix on network rejection", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    await expect(redditAdapter.fetch(redditCfg({ subreddits: ["down"] }))).rejects.toThrow(
      /reddit: error fetching .*down\/hot: ECONNRESET/,
    );
  });

  test("errorMessage on !ok", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      mocks.fetchMock.mockResolvedValue(makeErrorResponse(404));

      await expect(redditAdapter.fetch(redditCfg({ subreddits: ["test"] }))).rejects.toThrow(
        /reddit: failed to fetch/,
      );

      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 404" });
    } finally {
      emSpy.mockRestore();
    }
  });
});
