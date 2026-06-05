import { beforeEach, describe, expect, test } from "bun:test";

import adapter, { resolveMastodonMode } from "./adapters/mastodon";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const mastodonCfg = (params: Record<string, unknown> = {}) => adapterCfg("mastodon", params);

interface MastodonStatusFixture {
  id: string;
  uri: string;
  url: string;
  content: string;
  created_at: string;
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  account: {
    id: string;
    username: string;
    acct: string;
    display_name: string;
    url: string;
  };
  media_attachments: [];
  tags: [];
  spoiler_text: string;
  reblog: null;
}

function makeStatus(id: string, content: string, created: string): MastodonStatusFixture {
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

function fetchUrls(): string[] {
  return mocks.fetchMock.mock.calls.map((c) => String(c[0]));
}

describe("resolveMastodonMode", () => {
  test.each([
    [[], [], "public"],
    [[], ["rust"], "hashtag"],
    [[], ["#rust", "dev"], "hashtag"],
    [["user@ex.com"], [], "account"],
    [["@user@ex.com"], ["rust"], "account"],
    [["a@x.com", "b@y.com"], ["tag"], "account"],
  ] as const)("accounts=%j hashtags=%j → %s", (accounts, hashtags, expected) => {
    expect(resolveMastodonMode(accounts, hashtags)).toBe(expected);
  });
});

describe("mastodon", () => {
  beforeEach(() => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("/accounts/lookup")) {
        return new Response(
          JSON.stringify({
            id: "acct42",
            username: "test",
            acct: "test",
            display_name: "Test",
            url: "https://ex.com/@test",
          }),
          { status: 200 },
        );
      }

      if (urlStr.includes("/timelines/tag/foo")) {
        return new Response(
          JSON.stringify([
            makeStatus("1", "<p>post one</p>", "2024-01-01T10:00:00Z"),
            makeStatus("2", "<p>post two</p>", "2024-01-01T11:00:00Z"),
          ]),
          { status: 200 },
        );
      }
      if (urlStr.includes("/timelines/tag/bar")) {
        return new Response(
          JSON.stringify([
            makeStatus("2", "<p>post two</p>", "2024-01-01T11:00:00Z"),
            makeStatus("3", "<p>post three</p>", "2024-01-01T12:00:00Z"),
          ]),
          { status: 200 },
        );
      }

      if (urlStr.includes("/timelines/") || (urlStr.includes("/accounts/") && urlStr.includes("/statuses"))) {
        return new Response(
          JSON.stringify([
            makeStatus("10", "<p>hello <b>world</b></p>", "2024-05-01T00:00:00Z"),
            makeStatus("11", "short", "2024-05-02T00:00:00Z"),
          ]),
          { status: 200 },
        );
      }

      return new Response(null, { status: 404 });
    });
  });

  test("buildBody joins engagement helpers with acct, replies, and optional media", async () => {
    const withMedia = makeStatus("99", "<p>pic</p>", "2024-06-01T00:00:00Z");
    Object.assign(withMedia, {
      media_attachments: [
        { id: "m1", type: "image", url: "https://ex.com/1.png", preview_url: "", description: null },
        { id: "m2", type: "image", url: "https://ex.com/2.png", preview_url: "", description: null },
      ],
    });
    mocks.fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify([withMedia]), { status: 200 }),
    );

    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com", limit: 5 }));

    expect(items[0].body).toBe(
      "3 boosts | 7 favorites | @u@ex.com | 1 replies | media: https://ex.com/1.png https://ex.com/2.png",
    );
  });

  test("buildBody uses remote acct as-is and omits replies when zero", async () => {
    const remote = makeStatus("100", "<p>remote</p>", "2024-06-02T00:00:00Z");
    Object.assign(remote, {
      account: { ...remote.account, acct: "remote@other.social" },
      replies_count: 0,
    });
    mocks.fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify([remote]), { status: 200 }),
    );

    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com", limit: 5 }));

    expect(items[0].body).toBe("3 boosts | 7 favorites | @remote@other.social");
    expect(items[0].body).not.toContain("replies");
  });

  test("decodes HTML entities in item titles after stripHtml", async () => {
    const status = makeStatus("50", "<p>A &amp; B &#8364; C</p>", "2024-07-01T00:00:00Z");
    mocks.fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify([status]), { status: 200 }),
    );

    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com", limit: 5 }));
    expect(items[0].title).toBe("A & B € C");
  });

  test("decodes HTML entities in spoiler_text when content is empty", async () => {
    const status = makeStatus("51", "<p></p>", "2024-07-02T00:00:00Z");
    status.spoiler_text = "Spoiler &amp; &#8364;";
    mocks.fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify([status]), { status: 200 }),
    );

    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com", limit: 5 }));
    expect(items[0].title).toBe("Spoiler & €");
  });

  test("truncates long post titles to 200 characters with ellipsis", async () => {
    const longText = "x".repeat(250);
    const status = makeStatus("52", `<p>${longText}</p>`, "2024-07-03T00:00:00Z");
    mocks.fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify([status]), { status: 200 }),
    );

    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com", limit: 5 }));
    expect(items[0].title).toBe(`${"x".repeat(197)}...`);
    expect(items[0].title.length).toBe(200);
  });

  test("treats blank-only instance as default mastodon.social", async () => {
    const items = await adapter.fetch(mastodonCfg({ instance: "   " }));

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe("mastodon:mastodon.social");
    expect(fetchUrls().some((u) => u.includes("mastodon.social"))).toBe(true);
  });

  test("trims whitespace from configured instance", async () => {
    const items = await adapter.fetch(mastodonCfg({ instance: "  ex.com  " }));

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe("mastodon:ex.com");
    expect(fetchUrls().some((u) => u.includes("ex.com"))).toBe(true);
    expect(fetchUrls().every((u) => !u.includes("ex.com%20"))).toBe(true);
  });

  test("fetches from public timeline (default) and maps items", async () => {
    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com" }));
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i) => i.title).join(" ")).toContain("hello");
    expect(items[0].source).toBe("mastodon:ex.com");
    expect(items[0].body).toContain("boosts");
    expect(fetchUrls().some((u) => u.includes("/timelines/public"))).toBe(true);
  });

  test("fetches from hashtag timeline and builds source label", async () => {
    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com", hashtags: ["foo"] }));
    expect(items.length).toBe(2);
    expect(items[0].source).toBe("mastodon:ex.com:#foo");
    expect(fetchUrls().some((u) => u.includes("/timelines/tag/foo"))).toBe(true);
  });

  test("treats blank-only hashtags as public timeline", async () => {
    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com", hashtags: ["", "  "] }));

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe("mastodon:ex.com");
    expect(fetchUrls().some((u) => u.includes("/timelines/public"))).toBe(true);
    expect(fetchUrls().some((u) => u.includes("/timelines/tag/"))).toBe(false);
  });

  test("trims whitespace from configured hashtag names", async () => {
    const items = await adapter.fetch(
      mastodonCfg({ instance: "ex.com", hashtags: ["  foo  ", ""] }),
    );

    expect(items.length).toBe(2);
    expect(items[0].source).toBe("mastodon:ex.com:#foo");
    expect(fetchUrls().some((u) => u.includes("/timelines/tag/foo"))).toBe(true);
    expect(fetchUrls().filter((u) => u.includes("/timelines/tag/")).length).toBe(1);
  });

  test("fetches from account mode (lookup + statuses) and uses :accounts source", async () => {
    const items = await adapter.fetch(mastodonCfg({ accounts: ["test@ex.com"] }));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe("mastodon:mastodon.social:accounts");
    expect(fetchUrls().some((u) => u.includes("/accounts/lookup"))).toBe(true);
    expect(fetchUrls().some((u) => u.includes("/statuses"))).toBe(true);
  });

  test("treats blank-only accounts as public timeline", async () => {
    const items = await adapter.fetch(mastodonCfg({ instance: "ex.com", accounts: ["", "  "] }));

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe("mastodon:ex.com");
    expect(fetchUrls().some((u) => u.includes("/timelines/public"))).toBe(true);
    expect(fetchUrls().some((u) => u.includes("/accounts/lookup"))).toBe(false);
  });

  test("trims whitespace from configured account handles", async () => {
    const items = await adapter.fetch(
      mastodonCfg({ instance: "ex.com", accounts: ["  test@ex.com  ", ""] }),
    );

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBe("mastodon:ex.com:accounts");
    expect(fetchUrls().filter((u) => u.includes("/accounts/lookup")).length).toBe(1);
    expect(fetchUrls().some((u) => u.includes("/statuses"))).toBe(true);
  });

  test.each([NaN, "20", Infinity, -5, 0] as unknown[])(
    "invalid limit (%s) uses default limit=20 in API URL",
    async (limit) => {
      await adapter.fetch(mastodonCfg({ instance: "ex.com", limit }));

      const url = fetchUrls().find((u) => u.includes("/timelines/public"));
      expect(url ?? "").toContain("limit=20");
    },
  );

  test("caps limit at 40 in API URL", async () => {
    await adapter.fetch(mastodonCfg({ instance: "ex.com", limit: 500 }));

    const url = fetchUrls().find((u) => u.includes("/timelines/public"));
    expect(url ?? "").toContain("limit=40");
  });

  test("floors fractional limit in API URL", async () => {
    await adapter.fetch(mastodonCfg({ instance: "ex.com", limit: 7.9 }));

    const url = fetchUrls().find((u) => u.includes("/timelines/public"));
    expect(url ?? "").toContain("limit=7");
  });

  test("respects limit param (capped)", async () => {
    const items = await adapter.fetch(mastodonCfg({ limit: 1 }));
    expect(items).toHaveLength(1);
  });

  test("applies min_favourites filter and limit after fetch", async () => {
    const statuses = [
      makeStatus("low", "<p>low favs</p>", "2024-05-01T00:00:00Z"),
      makeStatus("mid", "<p>mid favs</p>", "2024-05-02T00:00:00Z"),
      makeStatus("high", "<p>high favs</p>", "2024-05-03T00:00:00Z"),
    ];
    statuses[0].favourites_count = 3;
    statuses[1].favourites_count = 12;
    statuses[2].favourites_count = 50;
    mocks.fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify(statuses), { status: 200 }),
    );

    const items = await adapter.fetch(
      mastodonCfg({ instance: "ex.com", min_favourites: 10, limit: 1 }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("high favs");
  });

  test("invalid min_favourites treated as 0 (no filter)", async () => {
    const statuses = [
      makeStatus("a", "<p>one</p>", "2024-05-01T00:00:00Z"),
      makeStatus("b", "<p>two</p>", "2024-05-02T00:00:00Z"),
    ];
    statuses[0].favourites_count = 1;
    statuses[1].favourites_count = 2;
    mocks.fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify(statuses), { status: 200 }),
    );

    const items = await adapter.fetch(
      mastodonCfg({ instance: "ex.com", min_favourites: "nope" as unknown as number }),
    );

    expect(items).toHaveLength(2);
  });

  test("passes only_media query when configured", async () => {
    await adapter.fetch(mastodonCfg({ only_media: true }));
    expect(fetchUrls().some((u) => u.includes("only_media=true"))).toBe(true);
  });

  test("merges multiple hashtags and deduplicates by status id", async () => {
    const items = await adapter.fetch(mastodonCfg({ hashtags: ["foo", "bar"] }));
    expect(items).toHaveLength(3);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
    expect(items[0].title).toContain("three");
  });

  test("throws on !ok fetch error (contract; no swallow)", async () => {
    mocks.fetchMock.mockImplementation(async () => new Response(null, { status: 500 }));

    await expect(adapter.fetch(mastodonCfg({ instance: "bad.com" }))).rejects.toThrow(
      /mastodon: failed to fetch public timeline from bad\.com: HTTP error 500/,
    );
  });

  test("throws on network error with adapter prefix", async () => {
    mocks.fetchMock.mockImplementation(async () => {
      throw new Error("network boom for mastodon test");
    });

    await expect(adapter.fetch(mastodonCfg({ instance: "example.invalid" }))).rejects.toThrow(
      /mastodon: error fetching public timeline from example\.invalid/,
    );
  });

  test("warns on account lookup HTTP failure and returns no items", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("/accounts/lookup")) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const items = await adapter.fetch(mastodonCfg({ accounts: ["missing@ex.com"] }));
    expect(items).toHaveLength(0);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "mastodon: failed to fetch account lookup missing@ex.com: HTTP error 404",
    );
  });

  test("warns on account lookup network failure and returns no items", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      if (urlStr.includes("/accounts/lookup")) {
        throw new Error("lookup connection refused");
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const items = await adapter.fetch(mastodonCfg({ accounts: ["user@ex.com"] }));
    expect(items).toHaveLength(0);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "mastodon: error fetching account lookup user@ex.com: lookup connection refused",
    );
  });
});