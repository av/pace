import { describe, expect, test } from "bun:test";
import npmAdapter, { npmSourceLabel, resolveNpmSort } from "./adapters/npm";
import { npmCfg } from "./test/adapter-cfg";
import { fetchMockCallUrl, useFetchMockSuite, withErrorMessageSpy } from "./test/adapter-mocks";
import { makeErrorResponse, makeJsonResponse } from "./test/fetch-responses";
import { invalidLimitParams } from "./test/invalid-params";
import { makePackageResult, makeSearchResponse } from "./test/npm-fixtures";

const mocks = useFetchMockSuite();

describe("npmSourceLabel", () => {
  test("uses @scope label when scope is set", () => {
    expect(npmSourceLabel("types", "optimal")).toBe("npm:@types");
  });

  test("uses sort label when no scope", () => {
    expect(npmSourceLabel(undefined, "popularity")).toBe("npm:popularity");
  });
});

describe("resolveNpmSort", () => {
  test.each([
    ["optimal", "optimal"],
    ["Optimal", "optimal"],
    ["OPTIMAL", "optimal"],
    ["quality", "quality"],
    ["Quality", "quality"],
    ["popularity", "popularity"],
    ["Popularity", "popularity"],
    ["maintenance", "maintenance"],
    ["Maintenance", "maintenance"],
    ["popular", "popularity"],
    ["maint", "maintenance"],
    ["default", "optimal"],
    ["invalid", "optimal"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(resolveNpmSort(input)).toBe(expected);
  });
});

describe("npm", () => {
  test("returns empty list and warns when no keywords or scope", async () => {
    const items = await npmAdapter.fetch(npmCfg());

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("npm: no keywords or scope configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("returns empty list and warns when keywords and scope are only blank strings", async () => {
    const items = await npmAdapter.fetch(
      npmCfg({ keywords: ["", "  "], scope: "  " }),
    );

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("npm: no keywords or scope configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured keywords and scope", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([makePackageResult()])),
    );

    await npmAdapter.fetch(
      npmCfg({ keywords: ["  typescript  ", ""], scope: "  types  " }),
    );

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("text=scope%3Atypes+typescript");
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  test("fetches packages by keywords", async () => {
    const pkg = makePackageResult();
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([pkg])),
    );

    const items = await npmAdapter.fetch(
      npmCfg({ keywords: ["typescript", "cli"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "npm:test-package@1.2.3",
      title: "test-package | A test package for testing",
      url: "https://www.npmjs.com/package/test-package",
      source: "npm:optimal",
    });
    expect(items[0].body).toContain("v1.2.3");
    expect(items[0].body).toContain("by testauthor");
    expect(items[0].body).toContain("quality: 80%");
    expect(items[0].body).toContain("popularity: 60%");
    expect(items[0].body).toContain("maintenance: 90%");

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("text=typescript+cli");
  });

  test("searches with scope parameter", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([makePackageResult()])),
    );

    await npmAdapter.fetch(npmCfg({ scope: "types", keywords: ["react"] }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("text=scope%3Atypes+react");
  });

  test("works with scope only (no keywords)", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([makePackageResult()])),
    );

    const items = await npmAdapter.fetch(npmCfg({ scope: "anthropic" }));

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("npm:@anthropic");
  });

  test("applies sort=popularity by boosting popularity score weight", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([])),
    );

    await npmAdapter.fetch(npmCfg({ keywords: ["react"], sort: "popularity" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("popularity=1.0");
    expect(calledUrl).toContain("quality=0.0");
    expect(calledUrl).toContain("maintenance=0.0");
  });

  test("applies sort=quality by boosting quality score weight", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([])),
    );

    await npmAdapter.fetch(npmCfg({ keywords: ["react"], sort: "quality" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("quality=1.0");
    expect(calledUrl).toContain("popularity=0.0");
  });

  test("applies sort=maintenance by boosting maintenance score weight", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([])),
    );

    await npmAdapter.fetch(npmCfg({ keywords: ["react"], sort: "maintenance" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("maintenance=1.0");
    expect(calledUrl).toContain("popularity=0.0");
    expect(calledUrl).toContain("quality=0.0");
  });

  test("defaults to optimal sort (no weight params) for invalid sort", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([])),
    );

    await npmAdapter.fetch(npmCfg({ keywords: ["react"], sort: "invalid" }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).not.toContain("quality=");
    expect(calledUrl).not.toContain("popularity=");
    expect(calledUrl).not.toContain("maintenance=");
  });

  test.each(invalidLimitParams(20))(
    "invalid limit (%s) uses default size=20 in API URL",
    async (limit) => {
      mocks.fetchMock.mockResolvedValue(
        makeJsonResponse(makeSearchResponse([])),
      );

      await npmAdapter.fetch(npmCfg({ keywords: ["test"], limit }));

      const calledUrl = fetchMockCallUrl(mocks.fetchMock);
      expect(calledUrl).toContain("size=20");
    },
  );

  test("floors fractional limit in API URL", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([])),
    );

    await npmAdapter.fetch(npmCfg({ keywords: ["test"], limit: 7.9 }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("size=7");
  });

  test("respects limit parameter", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([])),
    );

    await npmAdapter.fetch(npmCfg({ keywords: ["test"], limit: 5 }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("size=5");
  });

  test("caps limit at 50", async () => {
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([])),
    );

    await npmAdapter.fetch(npmCfg({ keywords: ["test"], limit: 200 }));

    const calledUrl = fetchMockCallUrl(mocks.fetchMock);
    expect(calledUrl).toContain("size=50");
  });

  test("includes tags and repository in body", async () => {
    const pkg = makePackageResult({
      package: {
        keywords: ["react", "hooks", "state", "typescript", "ui", "extra"],
        links: {
          npm: "https://npmjs.com/package/x",
          repository: "https://github.com/x/x",
        },
      },
    });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([pkg])),
    );

    const items = await npmAdapter.fetch(npmCfg({ keywords: ["react"] }));

    expect(items[0].body).toContain("tags: react, hooks, state, typescript, ui");
    expect(items[0].body).not.toContain("extra");
    expect(items[0].body).toContain("repo: https://github.com/x/x");
  });

  test("decodes HTML entities in package titles from API", async () => {
    const pkg = makePackageResult({
      package: {
        name: "pkg&amp;name",
        description: "A &amp; B &#8364; toolkit",
      },
    });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([pkg])),
    );

    const items = await npmAdapter.fetch(npmCfg({ keywords: ["test"] }));

    expect(items[0].title).toBe("pkg&name | A & B € toolkit");
    expect(items[0].title).not.toContain("&amp;");
    expect(items[0].title).not.toContain("&#8364;");
  });

  test("handles missing optional fields gracefully", async () => {
    const pkg = makePackageResult({
      package: {
        description: undefined,
        publisher: undefined,
        keywords: undefined,
        links: { npm: "https://npmjs.com/package/bare", repository: undefined },
      },
    });
    mocks.fetchMock.mockResolvedValue(
      makeJsonResponse(makeSearchResponse([pkg])),
    );

    const items = await npmAdapter.fetch(npmCfg({ keywords: ["bare"] }));

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("test-package");
    expect(items[0].body).not.toContain("by ");
    expect(items[0].body).not.toContain("tags:");
    expect(items[0].body).not.toContain("repo:");
  });

  test("throws on HTTP error with adapter prefix", async () => {
    mocks.fetchMock.mockResolvedValue(makeErrorResponse(429));

    await expect(
      npmAdapter.fetch(npmCfg({ keywords: ["test"] })),
    ).rejects.toThrow("npm:");
  });

  test("throws on network error with adapter prefix", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      npmAdapter.fetch(npmCfg({ keywords: ["test"] })),
    ).rejects.toThrow("npm:");
  });

  test("errorMessage on !ok and network", async () => {
    await withErrorMessageSpy(async (emSpy) => {
      mocks.fetchMock.mockResolvedValue(makeErrorResponse(429));
      await expect(
        npmAdapter.fetch(npmCfg({ keywords: ["test"] })),
      ).rejects.toThrow("npm:");
      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 429" });

      emSpy.mockClear();

      mocks.fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(
        npmAdapter.fetch(npmCfg({ keywords: ["test"] })),
      ).rejects.toThrow("npm:");
      expect(emSpy).toHaveBeenCalled();
    });
  });

  test("warns and returns [] when search response has malformed objects field", async () => {
    mocks.fetchMock.mockResolvedValue(makeJsonResponse({ objects: 42, total: 0 }));

    const items = await npmAdapter.fetch(npmCfg({ keywords: ["broken"] }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      'npm: expected array field "objects" for broken (got number), treating as empty',
    );
  });
});