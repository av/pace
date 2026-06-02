import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import npmAdapter from "./adapters/npm";
import * as typesMod from "./adapters/types";

const originalFetch = globalThis.fetch;

describe("npm", () => {
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof spyOn>;

  test("satisfies ngb contract: default export has .name and .fetch", () => {
    expect(npmAdapter.name).toBe("npm");
    expect(typeof npmAdapter.fetch).toBe("function");
  });

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    warnSpy.mockRestore();
    mock.restore();
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
    expect(warnSpy).toHaveBeenCalledWith("npm: no keywords or scope configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetches packages by keywords", async () => {
    const pkg = makePackageResult();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([pkg])), { status: 200 }),
    );

    const items = await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["typescript", "cli"] },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "npm:test-package@1.2.3",
      title: "test-package — A test package for testing",
      url: "https://www.npmjs.com/package/test-package",
      source: "npm:optimal",
    });
    expect(items[0].body).toContain("v1.2.3");
    expect(items[0].body).toContain("by testauthor");
    expect(items[0].body).toContain("quality: 80%");
    expect(items[0].body).toContain("popularity: 60%");
    expect(items[0].body).toContain("maintenance: 90%");

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("text=typescript+cli");
  });

  test("searches with scope parameter", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([makePackageResult()])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { scope: "types", keywords: ["react"] },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("text=scope%3Atypes+react");
  });

  test("works with scope only (no keywords)", async () => {
    fetchMock.mockResolvedValue(
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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "popularity" },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("popularity=1.0");
    expect(calledUrl).toContain("quality=0.0");
    expect(calledUrl).toContain("maintenance=0.0");
  });

  test("applies sort=quality by boosting quality score weight", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "quality" },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("quality=1.0");
    expect(calledUrl).toContain("popularity=0.0");
  });

  test("applies sort=maintenance by boosting maintenance score weight", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "maintenance" },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("maintenance=1.0");
    expect(calledUrl).toContain("popularity=0.0");
    expect(calledUrl).toContain("quality=0.0");
  });

  test("defaults to optimal sort (no weight params) for invalid sort", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "invalid" },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain("quality=");
    expect(calledUrl).not.toContain("popularity=");
    expect(calledUrl).not.toContain("maintenance=");
  });

  test("respects limit parameter", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["test"], limit: 5 },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("size=5");
  });

  test("caps limit at 50", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["test"], limit: 200 },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
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
    fetchMock.mockResolvedValue(
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

  test("handles missing optional fields gracefully", async () => {
    const pkg = makePackageResult({
      package: {
        description: undefined,
        publisher: undefined,
        keywords: undefined,
        links: { npm: "https://npmjs.com/package/bare", repository: undefined },
      },
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([pkg])), { status: 200 }),
    );

    const items = await npmAdapter.fetch({
      type: "npm",
      params: { keywords: ["bare"] },
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("test-package — ");
    expect(items[0].body).not.toContain("by ");
    expect(items[0].body).not.toContain("tags:");
    expect(items[0].body).not.toContain("repo:");
  });

  test("throws on HTTP error with adapter prefix", async () => {
    fetchMock.mockResolvedValue(new Response("Rate limited", { status: 429 }));

    await expect(
      npmAdapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
    ).rejects.toThrow("npm:");
  });

  test("throws on network error with adapter prefix", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      npmAdapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
    ).rejects.toThrow("npm:");
  });

  test("uses errorMessage helper in !ok and network error paths", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      fetchMock.mockResolvedValue(new Response("Rate limited", { status: 429 }));
      await expect(
        npmAdapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
      ).rejects.toThrow("npm:");
      expect(emSpy).toHaveBeenCalledWith({ message: "429" });

      emSpy.mockClear();

      fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(
        npmAdapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
      ).rejects.toThrow("npm:");
      expect(emSpy).toHaveBeenCalled();
    } finally {
      emSpy.mockRestore();
    }
  });
});