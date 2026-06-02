import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import lemmyAdapter from "./adapters/lemmy";
import * as typesMod from "./adapters/types";

const originalFetch = globalThis.fetch;

describe("lemmy adapter", () => {
  let fetchMock: ReturnType<typeof mock>;

  test("satisfies ngb contract: default export has .name and .fetch", () => {
    expect(lemmyAdapter.name).toBe("lemmy");
    expect(typeof lemmyAdapter.fetch).toBe("function");
  });

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  function makePostView(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      post: {
        id: 1001,
        name: "Test Post Title",
        url: "https://example.com/article",
        body: "Post body text",
        ap_id: "https://lemmy.ml/post/1001",
        published: "2025-01-15T10:00:00Z",
        ...(overrides.post as object | undefined),
      },
      creator: {
        name: "testuser",
        actor_id: "https://lemmy.ml/u/testuser",
        ...(overrides.creator as object | undefined),
      },
      community: {
        name: "technology",
        title: "Technology",
        actor_id: "https://lemmy.ml/c/technology",
        ...(overrides.community as object | undefined),
      },
      counts: {
        score: 42,
        upvotes: 50,
        downvotes: 8,
        comments: 15,
        ...(overrides.counts as object | undefined),
      },
    };
  }

  function makePostListResponse(posts: Record<string, unknown>[]) {
    return { posts };
  }

  test("fetches frontpage from default instance when no communities specified", async () => {
    const view = makePostView();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse([view])), { status: 200 }),
    );

    const items = await lemmyAdapter.fetch({ type: "lemmy", params: {} });

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

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("lemmy.ml");
    expect(calledUrl).toContain("sort=Hot");
  });

  test("fetches specific communities", async () => {
    const view1 = makePostView({ post: { id: 1 }, community: { name: "linux" } });
    const view2 = makePostView({ post: { id: 2 }, community: { name: "rust" } });

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePostListResponse([view1])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePostListResponse([view2])), { status: 200 }),
      );

    const items = await lemmyAdapter.fetch({
      type: "lemmy",
      params: { communities: ["linux", "rust"] },
    });

    expect(items).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const url1 = String(fetchMock.mock.calls[0][0]);
    expect(url1).toContain("community_name=linux");
    const url2 = String(fetchMock.mock.calls[1][0]);
    expect(url2).toContain("community_name=rust");
  });

  test("uses custom instance", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse([])), { status: 200 }),
    );

    await lemmyAdapter.fetch({
      type: "lemmy",
      params: { instance: "lemmy.world", communities: ["test"] },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("lemmy.world");
  });

  test("applies sort parameter (case-insensitive)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse([])), { status: 200 }),
    );

    await lemmyAdapter.fetch({ type: "lemmy", params: { sort: "new" } });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("sort=New");
  });

  test("defaults invalid sort to Hot", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse([])), { status: 200 }),
    );

    await lemmyAdapter.fetch({ type: "lemmy", params: { sort: "invalid" } });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("sort=Hot");
  });

  test("resolves sort aliases (most_comments -> MostComments)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse([])), { status: 200 }),
    );

    await lemmyAdapter.fetch({ type: "lemmy", params: { sort: "most_comments" } });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("sort=MostComments");
  });

  test("applies min_score filter", async () => {
    const posts = [
      makePostView({ post: { id: 1 }, counts: { score: 5 } }),
      makePostView({ post: { id: 2 }, counts: { score: 100 } }),
      makePostView({ post: { id: 3 }, counts: { score: 20 } }),
    ];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse(posts)), { status: 200 }),
    );

    const items = await lemmyAdapter.fetch({
      type: "lemmy",
      params: { min_score: 10 },
    });

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("lemmy:lemmy.ml:2");
    expect(items[1].id).toBe("lemmy:lemmy.ml:3");
  });

  test("applies limit after filtering", async () => {
    const posts = Array.from({ length: 10 }, (_, i) =>
      makePostView({ post: { id: i + 1 }, counts: { score: 100 - i * 10 } }),
    );
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse(posts)), { status: 200 }),
    );

    const items = await lemmyAdapter.fetch({
      type: "lemmy",
      params: { limit: 3 },
    });

    expect(items).toHaveLength(3);
  });

  test("deduplicates posts by ID across communities", async () => {
    const samePost = makePostView({ post: { id: 999 } });

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePostListResponse([samePost])), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makePostListResponse([samePost])), { status: 200 }),
      );

    const items = await lemmyAdapter.fetch({
      type: "lemmy",
      params: { communities: ["linux", "opensource"] },
    });

    expect(items).toHaveLength(1);
  });

  test("uses ap_id as URL for self posts (no external URL)", async () => {
    const selfPost = makePostView({
      post: { id: 5, url: undefined, ap_id: "https://lemmy.ml/post/5" },
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse([selfPost])), { status: 200 }),
    );

    const items = await lemmyAdapter.fetch({ type: "lemmy", params: {} });

    expect(items[0].url).toBe("https://lemmy.ml/post/5");
  });

  test("includes discuss link for external URLs", async () => {
    const linkPost = makePostView({
      post: { id: 7, url: "https://example.com/article", ap_id: "https://lemmy.ml/post/7" },
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse([linkPost])), { status: 200 }),
    );

    const items = await lemmyAdapter.fetch({ type: "lemmy", params: {} });

    expect(items[0].body).toContain("discuss: https://lemmy.ml/post/7");
  });

  test("sets source label for single community", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makePostListResponse([makePostView()])), { status: 200 }),
    );

    const items = await lemmyAdapter.fetch({
      type: "lemmy",
      params: { communities: ["technology"], instance: "lemmy.world" },
    });

    expect(items[0].source).toBe("lemmy:lemmy.world:c/technology");
  });

  test("throws on HTTP error with adapter prefix", async () => {
    fetchMock.mockResolvedValue(new Response("Server Error", { status: 500 }));

    await expect(
      lemmyAdapter.fetch({ type: "lemmy", params: {} }),
    ).rejects.toThrow("lemmy:");
  });

  test("throws on network error with adapter prefix", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      lemmyAdapter.fetch({ type: "lemmy", params: {} }),
    ).rejects.toThrow("lemmy:");
  });

  test("uses errorMessage helper in !ok and network error paths", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      fetchMock.mockResolvedValue(new Response("Server Error", { status: 500 }));
      await expect(
        lemmyAdapter.fetch({ type: "lemmy", params: {} }),
      ).rejects.toThrow("lemmy:");

      fetchMock.mockRejectedValue(new Error("connection refused"));
      await expect(
        lemmyAdapter.fetch({ type: "lemmy", params: {} }),
      ).rejects.toThrow("lemmy:");

      expect(emSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(emSpy).toHaveBeenCalledWith({ message: "500" });
    } finally {
      emSpy.mockRestore();
    }
  });
});