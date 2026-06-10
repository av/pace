import { beforeEach, describe, expect, test } from "bun:test";
import devtoAdapter, {
  devtoSourceLabel,
  devToFetchKeys,
  resolveDevToPeriod,
} from "./adapters/devto";
import { fetchMockCalls, useFetchMockSuite, withErrorMessageSpy } from "./test/adapter-mocks";
import { devtoCfg } from "./test/adapter-cfg";
import { devtoDefaultFetchMock, makeDevToArticle } from "./test/devto-fixtures";
import { makeErrorResponse, makeJsonResponse } from "./test/fetch-responses";
import { invalidLimitParams, invalidMinScoreParams } from "./test/invalid-params";

const mocks = useFetchMockSuite();

const devtoFetchCalls = () => fetchMockCalls(mocks.fetchMock);

describe("devtoSourceLabel", () => {
  test("uses username when set", () => {
    expect(devtoSourceLabel("alice", ["typescript"])).toBe("devto:alice");
  });

  test("uses single tag when no username", () => {
    expect(devtoSourceLabel(undefined, ["typescript"])).toBe("devto:typescript");
  });

  test("joins multiple tags with + when no username", () => {
    expect(devtoSourceLabel(undefined, ["typescript", "react"])).toBe("devto:typescript+react");
  });
});

describe("devToFetchKeys", () => {
  test("orders username before tags when both configured", () => {
    expect(devToFetchKeys("alice", ["typescript", "react"])).toEqual([
      { kind: "user", username: "alice" },
      { kind: "tag", tag: "typescript" },
      { kind: "tag", tag: "react" },
    ]);
  });

  test("returns empty list when neither username nor tags set", () => {
    expect(devToFetchKeys(undefined, [])).toEqual([]);
  });
});

describe("resolveDevToPeriod", () => {
  test.each([
    [1, 1],
    [0, 1],
    [3, 7],
    [7, 7],
    [14, 30],
    [30, 30],
    [100, 365],
    [365, 365],
    [1000, 365],
    ["day", 1],
    ["DAY", 1],
    ["1", 1],
    ["week", 7],
    ["7", 7],
    ["month", 30],
    ["30", 30],
    ["year", 365],
    ["365", 365],
    ["infinity", 365],
    ["all", 365],
    ["unknown", 7],
    [undefined, 7],
    [NaN, 365],
    [Infinity, 365],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(resolveDevToPeriod(input)).toBe(expected);
  });
});

describe("devto", () => {
  beforeEach(() => {
    mocks.fetchMock.mockImplementation(devtoDefaultFetchMock);
  });

  test.each(invalidLimitParams(20))(
    "invalid limit (%s) sends per_page=20 to API",
    async (limit) => {
      await devtoAdapter.fetch(devtoCfg({ tags: ["typescript"], limit }));
      const call = devtoFetchCalls().find((c) => c.url.includes("tag=typescript"));
      expect(call?.url ?? "").toContain("per_page=20");
    },
  );

  test("caps per_page at 30 in API query", async () => {
    await devtoAdapter.fetch(devtoCfg({ tags: ["typescript"], limit: 500 }));
    const call = devtoFetchCalls().find((c) => c.url.includes("tag=typescript"));
    expect(call?.url ?? "").toContain("per_page=30");
  });

  test("floors fractional limit in per_page query param", async () => {
    await devtoAdapter.fetch(devtoCfg({ tags: ["typescript"], limit: 7.9 }));
    const call = devtoFetchCalls().find((c) => c.url.includes("tag=typescript"));
    expect(call?.url ?? "").toContain("per_page=7");
  });

  test("per_page param takes precedence over limit for API per_page", async () => {
    await devtoAdapter.fetch(
      devtoCfg({ tags: ["typescript"], limit: 5, per_page: 12 }),
    );
    const call = devtoFetchCalls().find((c) => c.url.includes("tag=typescript"));
    expect(call?.url ?? "").toContain("per_page=12");
    expect(call?.url ?? "").not.toContain("per_page=5");
  });

  test("resolvePeriod maps aliases (month->30, day->1 etc) into query param sent to fetchDevToArticles", async () => {
    await devtoAdapter.fetch(devtoCfg({ tags: ["typescript"], top: "month", limit: 5 }));
    const tsCall = devtoFetchCalls().find((c) => c.url.includes("tag=typescript"));
    expect(tsCall?.url ?? "").toContain("top=30");

    mocks.fetchMock.mockClear();
    await devtoAdapter.fetch(devtoCfg({ tags: ["react"], limit: 5 }));
    const reactCall = devtoFetchCalls().find((c) => c.url.includes("tag=react"));
    expect(reactCall?.url ?? "").toContain("top=7");
  });

  test("buildBody formats reactions, comments, read time, author, tags and cover", async () => {
    const items = await devtoAdapter.fetch(devtoCfg({ username: "testuser", limit: 20 }));
    expect(items[0].body).toBe(
      "42 reactions | 3 comments | 5 min read | by @testuser | tags: typescript | cover: https://example.com/cover.jpg",
    );
  });

  test("decodes HTML entities in article titles from API", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("tag=javascript")) {
        return makeJsonResponse([
          makeDevToArticle(401, {
            title: "A &amp; B &#8364; C",
            url: "https://dev.to/j/article",
            reading_time_minutes: 3,
            positive_reactions_count: 1,
            comments_count: 0,
            user: { username: "j", name: "J" },
            tag_list: ["javascript"],
          }),
        ]);
      }
      return devtoDefaultFetchMock(input);
    });

    const items = await devtoAdapter.fetch(devtoCfg({ tags: ["javascript"], limit: 5 }));
    expect(items[0].title).toBe("A & B € C");
  });

  test("fetch with username only calls API with username param and returns mapped item with correct source and body", async () => {
    const items = await devtoAdapter.fetch(devtoCfg({ username: "testuser", limit: 20 }));
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("devto:101");
    expect(items[0].title).toBe("User Article");
    expect(items[0].source).toBe("devto:testuser");
    expect(items[0].body).toContain("5 min read");
    expect(items[0].body).toContain("by @testuser");
    expect(items[0].body).toContain("cover: https://example.com/cover.jpg");
    expect(devtoFetchCalls().some((c) => c.url.includes("username=testuser"))).toBe(true);
  });

  test("fetch with tags only calls per-tag and aggregates items", async () => {
    const items = await devtoAdapter.fetch(devtoCfg({ tags: ["typescript"], limit: 20 }));
    expect(items.length).toBe(1);
    expect(items[0].source).toBe("devto:typescript");
    expect(devtoFetchCalls().some((c) => c.url.includes("tag=typescript"))).toBe(true);
  });

  test("fetch with multiple tags + username dedupes by id and applies min_reactions filter and sorts by reactions desc", async () => {
    const items = await devtoAdapter.fetch(
      devtoCfg({
        username: "testuser",
        tags: ["typescript", "react"],
        min_reactions: 10,
        limit: 5,
      }),
    );
    expect(items.length).toBe(2);
    expect(items[0].title).toBe("Tag Article One");
    expect(items[1].title).toBe("User Article");
    const calls = devtoFetchCalls();
    expect(calls.filter((c) => c.url.includes("username=")).length).toBe(1);
    expect(calls.filter((c) => c.url.includes("tag=typescript")).length).toBe(1);
    expect(calls.filter((c) => c.url.includes("tag=react")).length).toBe(1);
  });

  test.each(invalidMinScoreParams(10))(
    "invalid min_reactions (%s) treated as 0 (no reactions filter)",
    async (min_reactions) => {
      mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("tag=typescript")) {
          return makeJsonResponse([
            makeDevToArticle(601, {
              title: "Low Reactions",
              url: "https://dev.to/low",
              published_at: "2024-01-20T00:00:00Z",
              reading_time_minutes: 1,
              positive_reactions_count: 5,
              comments_count: 0,
              user: { username: "low", name: "Low" },
            }),
            makeDevToArticle(602, {
              title: "High Reactions",
              url: "https://dev.to/high",
              published_at: "2024-01-21T00:00:00Z",
              reading_time_minutes: 1,
              positive_reactions_count: 100,
              comments_count: 0,
              user: { username: "high", name: "High" },
            }),
          ]);
        }
        return makeJsonResponse([]);
      });

      const items = await devtoAdapter.fetch(
        devtoCfg({ tags: ["typescript"], min_reactions, limit: 10 }),
      );

      expect(items).toHaveLength(2);
    },
  );

  test("fetch respects limit after filtering/sorting", async () => {
    const items = await devtoAdapter.fetch(devtoCfg({ tags: ["typescript", "react"], limit: 1 }));
    expect(items.length).toBe(1);
    expect(items[0].title).toBe("Tag Article One");
  });

  test("returns [] and warns when no tags or username configured", async () => {
    const items = await devtoAdapter.fetch(devtoCfg());
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("devto: no tags or username configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("returns [] and warns when tags are only blank strings", async () => {
    const items = await devtoAdapter.fetch(devtoCfg({ tags: ["", "  "] }));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("devto: no tags or username configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("whitespace-only username is treated as unconfigured", async () => {
    const items = await devtoAdapter.fetch(devtoCfg({ username: "   " }));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("devto: no tags or username configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured username", async () => {
    const items = await devtoAdapter.fetch(devtoCfg({ username: "  testuser  ", limit: 20 }));
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("devto:testuser");
    expect(devtoFetchCalls().some((c) => c.url.includes("username=testuser"))).toBe(true);
    expect(devtoFetchCalls().every((c) => !c.url.includes("username=") || c.url.includes("username=testuser"))).toBe(
      true,
    );
  });

  test("trims whitespace from configured tag names", async () => {
    mocks.fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("tag=javascript")) {
        return makeJsonResponse([
          makeDevToArticle(501, {
            title: "Trimmed Tag",
            url: "https://dev.to/trim",
            published_at: "2024-01-19T00:00:00Z",
            reading_time_minutes: 1,
            positive_reactions_count: 1,
            comments_count: 0,
            user: { username: "t", name: "T" },
            tag_list: ["javascript"],
          }),
        ]);
      }
      return devtoDefaultFetchMock(input);
    });

    const items = await devtoAdapter.fetch(devtoCfg({ tags: ["  javascript  ", ""] }));
    expect(items).toHaveLength(1);
    expect(devtoFetchCalls().some((c) => c.url.includes("tag=javascript"))).toBe(true);
    expect(devtoFetchCalls().every((c) => !c.url.includes("tag=") || c.url.includes("tag=javascript"))).toBe(
      true,
    );
  });

  test("throws on network rejection with devto-prefixed message", async () => {
    mocks.fetchMock.mockImplementation(async () => {
      throw new Error("network boom for devto test");
    });

    await expect(devtoAdapter.fetch(devtoCfg({ tags: ["javascript"] }))).rejects.toThrow(
      'devto: error fetching tag "javascript": network boom for devto test',
    );
  });

  test("errorMessage on !ok", async () => {
    await withErrorMessageSpy(async (emSpy) => {
      mocks.fetchMock.mockResolvedValue(makeErrorResponse(403));

      await expect(devtoAdapter.fetch(devtoCfg({ tags: ["javascript"] }))).rejects.toThrow(
        'devto: failed to fetch tag "javascript": HTTP error 403',
      );

      expect(emSpy).toHaveBeenCalledTimes(1);
      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 403" });
    });
  });
});