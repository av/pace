import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import adapter from "./github-releases";

const originalFetch = globalThis.fetch;

function makeRelease(
  id: number,
  tagName: string,
  name: string | null = null,
  body: string | null = "Release notes here.",
  publishedAt = "2024-05-20T12:00:00Z",
) {
  return {
    id,
    tag_name: tagName,
    name,
    html_url: `https://github.com/owner/repo/releases/tag/${tagName}`,
    body,
    published_at: publishedAt,
  };
}

describe("github-releases adapter (TDD quality + test coverage)", () => {
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("returns [] with no fetch when no repos configured", async () => {
    const items = await adapter.fetch({ params: {} } as any);
    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    const items2 = await adapter.fetch({ params: { repos: [] } } as any);
    expect(items2).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetches single repo and maps fields correctly (name fallback, body, id/source/timestamp)", async () => {
    const release = makeRelease(123, "v1.2.3", "My Release", "Notes about v1.2.3");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([release]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const items = await adapter.fetch({ params: { repos: ["owner/repo"] } } as any);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: "github:owner/repo:123",
      title: "My Release",
      url: "https://github.com/owner/repo/releases/tag/v1.2.3",
      source: "github:owner/repo",
      timestamp: new Date("2024-05-20T12:00:00Z"),
      body: "Notes about v1.2.3",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/releases?per_page=5",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/vnd.github+json", "User-Agent": "pace/1.0" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test("falls back title to tag_name when name is null, omits body when null", async () => {
    const release = makeRelease(456, "v2.0.0", null, null);
    fetchMock.mockResolvedValue(new Response(JSON.stringify([release]), { status: 200 }));

    const [item] = await adapter.fetch({ params: { repos: ["owner/repo"] } } as any);

    expect(item.title).toBe("v2.0.0");
    expect(item.body).toBeUndefined();
  });

  test("fetches multiple repos in parallel and flattens results", async () => {
    const r1 = makeRelease(1, "v1", "R1");
    const r2 = makeRelease(2, "v2", "R2");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([r1]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([r2]), { status: 200 }));

    const items = await adapter.fetch({ params: { repos: ["a/b", "c/d"] } } as any);

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual(["R1", "R2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("includes Authorization Bearer when token provided in params", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await adapter.fetch({ params: { repos: ["owner/repo"], token: "ghp_secret123" } } as any);

    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe("Bearer ghp_secret123");
  });

  test("throws wrapped error on non-ok response with exact 'github-releases: failed to fetch ...' prefix", async () => {
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(
      adapter.fetch({ params: { repos: ["missing/repo"] } } as any),
    ).rejects.toThrow("github-releases: failed to fetch missing/repo: 404");
  });

  test("throws wrapped error on network/reject with 'github-releases: error fetching ...' prefix", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      adapter.fetch({ params: { repos: ["owner/repo"] } } as any),
    ).rejects.toThrow("github-releases: error fetching owner/repo: ECONNRESET");
  });

  test("handles json parse failure as wrapped fetch error", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(
      adapter.fetch({ params: { repos: ["owner/repo"] } } as any),
    ).rejects.toThrow(/github-releases: error fetching owner\/repo: /);
  });
});
