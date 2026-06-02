import { describe, expect, spyOn, test } from "bun:test";
import npmAdapter from "./adapters/npm";
import * as typesMod from "./adapters/types";
import { useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();

describe("npm", () => {
  test("ngb contract", () => {
    expect(npmAdapter.name).toBe("npm");
    expect(typeof npmAdapter.fetch).toBe("function");
  });

  function makePackageResult(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      package: {
        name: "test-package",
        version: "1.2.3",
        description: "A test package for testing",
        date: "2025-01-15T10:00:00Z",
        links: {
          npm: "https://www.npmjs.com/package/test-package",
          homepage: "https://test-package.dev",
          repository: "https://github.com/test/test-package",
        },
        publisher: { username: "testauthor" },
        keywords: ["testing", "utility"],
        ...(overrides.package as object | undefined),
      },
      score: {
        final: 0.75,
        detail: {
          quality: 0.8,
          popularity: 0.6,
          maintenance: 0.9,
          ...(overrides.detail as object | undefined),
        },
        ...(overrides.score as object | undefined),
      },
    };
  }

  function makeSearchResponse(objects: Record<string, unknown>[]) {
    return { objects, total: objects.length };
  }

  test("returns empty list and warns when no keywords or scope", async () => {
    const items = await npmAdapter.fetch({ type: "npm", params: {} });

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("npm: no keywords or scope configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("returns empty list and warns when keywords and scope are only blank strings", async () => {
    const items = await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["", "  "], scope: "  " },
    });

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith("npm: no keywords or scope configured");
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured keywords and scope", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([makePackageResult()])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["  typescript  ", ""], scope: "  types  " },
    });

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("text=scope%3Atypes+typescript");
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
  });

  test("fetches packages by keywords", async () => {
    const pkg = makePackageResult();
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([pkg])), { status: 200 }),
    );

    const items = await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["typescript", "cli"] },
    });

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

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("text=typescript+cli");
  });

  test("searches with scope parameter", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([makePackageResult()])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { scope: "types", keywords: ["react"] },
    });

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("text=scope%3Atypes+react");
  });

  test("works with scope only (no keywords)", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([makePackageResult()])), { status: 200 }),
    );

    const items = await npmAdapter.fetch({
      type: "npm",
      params: { scope: "anthropic" },
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("npm:@anthropic");
  });

  test("applies sort=popularity by boosting popularity score weight", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "popularity" },
    });

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("popularity=1.0");
    expect(calledUrl).toContain("quality=0.0");
    expect(calledUrl).toContain("maintenance=0.0");
  });

  test("applies sort=quality by boosting quality score weight", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "quality" },
    });

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("quality=1.0");
    expect(calledUrl).toContain("popularity=0.0");
  });

  test("applies sort=maintenance by boosting maintenance score weight", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "maintenance" },
    });

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("maintenance=1.0");
    expect(calledUrl).toContain("popularity=0.0");
    expect(calledUrl).toContain("quality=0.0");
  });

  test("defaults to optimal sort (no weight params) for invalid sort", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "invalid" },
    });

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain("quality=");
    expect(calledUrl).not.toContain("popularity=");
    expect(calledUrl).not.toContain("maintenance=");
  });

  test("respects limit parameter", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["test"], limit: 5 },
    });

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("size=5");
  });

  test("caps limit at 50", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["test"], limit: 200 },
    });

    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
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
      new Response(JSON.stringify(makeSearchResponse([pkg])), { status: 200 }),
    );

    const items = await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"] },
    });

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
      new Response(JSON.stringify(makeSearchResponse([pkg])), { status: 200 }),
    );

    const items = await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["test"] },
    });

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
      new Response(JSON.stringify(makeSearchResponse([pkg])), { status: 200 }),
    );

    const items = await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["bare"] },
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("test-package");
    expect(items[0].body).not.toContain("by ");
    expect(items[0].body).not.toContain("tags:");
    expect(items[0].body).not.toContain("repo:");
  });

  test("throws on HTTP error with adapter prefix", async () => {
    mocks.fetchMock.mockResolvedValue(new Response("Rate limited", { status: 429 }));

    await expect(
      npmAdapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
    ).rejects.toThrow("npm:");
  });

  test("throws on network error with adapter prefix", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      npmAdapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
    ).rejects.toThrow("npm:");
  });

  test("errorMessage on !ok and network", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      mocks.fetchMock.mockResolvedValue(new Response("Rate limited", { status: 429 }));
      await expect(
        npmAdapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
      ).rejects.toThrow("npm:");
      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 429" });

      emSpy.mockClear();

      mocks.fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(
        npmAdapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
      ).rejects.toThrow("npm:");
      expect(emSpy).toHaveBeenCalled();
    } finally {
      emSpy.mockRestore();
    }
  });
});