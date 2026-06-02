import { beforeEach, afterEach, describe, expect, test } from "bun:test";

import adapter from "./adapters/mastodon";

describe("mastodon adapter", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: Array<{ url: string; init: any }>;

  function makeStatus(id: string, content: string, created: string): any {
    return {
      id,
      uri: `https://ex.com/status/${id}`,
      url: `https://ex.com/@u/${id}`,
      content,
      created_at: created,
      reblogs_count: 3,
      favourites_count: 7,
      replies_count: 1,
      account: {
        id: "a1",
        username: "u",
        acct: "u",
        display_name: "U",
        url: "https://ex.com/@u",
      },
      media_attachments: [],
      tags: [],
      spoiler_text: "",
      reblog: null,
    };
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      fetchCalls.push({ url: urlStr, init });

      if (urlStr.includes("/accounts/lookup")) {
        return new Response(
          JSON.stringify({
            id: "acct42",
            username: "test",
            acct: "test",
            display_name: "Test",
            url: "https://ex.com/@test",
          }),
          { status: 200 }
        );
      }

      // hashtag specific for dedup/merge test
      if (urlStr.includes("/timelines/tag/foo")) {
        return new Response(
          JSON.stringify([makeStatus("1", "<p>post one</p>", "2024-01-01T10:00:00Z"), makeStatus("2", "<p>post two</p>", "2024-01-01T11:00:00Z")]),
          { status: 200 }
        );
      }
      if (urlStr.includes("/timelines/tag/bar")) {
        return new Response(
          JSON.stringify([makeStatus("2", "<p>post two</p>", "2024-01-01T11:00:00Z"), makeStatus("3", "<p>post three</p>", "2024-01-01T12:00:00Z")]),
          { status: 200 }
        );
      }

      // default success for public, other tags, account statuses
      if (urlStr.includes("/timelines/") || urlStr.includes("/accounts/") && urlStr.includes("/statuses")) {
        return new Response(
          JSON.stringify([
            makeStatus("10", "<p>hello <b>world</b></p>", "2024-05-01T00:00:00Z"),
            makeStatus("11", "short", "2024-05-02T00:00:00Z"),
          ]),
          { status: 200 }
        );
      }

      return new Response(null, { status: 404 });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetches from public timeline (default) and maps items", async () => {
    const items = await adapter.fetch({ params: { instance: "ex.com" } } as any);
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i) => i.title).join(" ")).toContain("hello");
    expect(items[0].source).toBe("mastodon:ex.com");
    expect(items[0].body).toContain("boosts");
    expect(fetchCalls.some((c) => c.url.includes("/timelines/public"))).toBe(true);
  });

  test("fetches from hashtag timeline and builds source label", async () => {
    const items = await adapter.fetch({ params: { instance: "ex.com", hashtags: ["foo"] } } as any);
    expect(items.length).toBe(2);
    expect(items[0].source).toBe("mastodon:ex.com:#foo");
    expect(fetchCalls.some((c) => c.url.includes("/timelines/tag/foo"))).toBe(true);
  });

  test("fetches from account mode (lookup + statuses) and uses :accounts source", async () => {
    const items = await adapter.fetch({ params: { accounts: ["test@ex.com"] } } as any);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe("mastodon:mastodon.social:accounts"); // config default instance used for label
    expect(fetchCalls.some((c) => c.url.includes("/accounts/lookup"))).toBe(true);
    expect(fetchCalls.some((c) => c.url.includes("/statuses"))).toBe(true);
  });

  test("respects limit param (capped)", async () => {
    const items = await adapter.fetch({ params: { limit: 1 } } as any);
    expect(items).toHaveLength(1);
  });

  test("passes only_media query when configured", async () => {
    await adapter.fetch({ params: { only_media: true } } as any);
    expect(fetchCalls.some((c) => c.url.includes("only_media=true"))).toBe(true);
  });

  test("merges multiple hashtags and deduplicates by status id", async () => {
    const items = await adapter.fetch({ params: { hashtags: ["foo", "bar"] } } as any);
    // foo gives 1+2, bar gives 2+3 -> dedup to 3 unique, sorted newest first
    expect(items).toHaveLength(3);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
    // newest first by created_at
    expect(items[0].title).toContain("three");
  });

  test("throws on !ok fetch error (contract; no swallow)", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 500 });
    try {
      await expect(
        adapter.fetch({ params: { instance: "bad.com" } } as any),
      ).rejects.toThrow(/mastodon:.*failed to fetch.*bad\.com.*500/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
