import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import adapter from "./npm";
import * as typesMod from "./types";

describe("npm adapter", () => {
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as any;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makePackageResult(overrides: Partial<any> = {}): any {
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
        ...overrides.package,
      },
      score: {
        final: 0.75,
        detail: {
          quality: 0.8,
          popularity: 0.6,
          maintenance: 0.9,
          ...overrides.detail,
        },
        ...overrides.score,
      },
    };
  }

  function makeSearchResponse(objects: any[]) {
    return { objects, total: objects.length };
  }

  it("returns empty list and warns when no keywords or scope", async () => {
    const items = await adapter.fetch({ type: "npm", params: {} });

    expect(items).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith("npm: no keywords or scope configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches packages by keywords", async () => {
    const pkg = makePackageResult();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([pkg])), { status: 200 }),
    );

    const items = await adapter.fetch({
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

  it("searches with scope parameter", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([makePackageResult()])), { status: 200 }),
    );

    await adapter.fetch({
      type: "npm",
      params: { scope: "types", keywords: ["react"] },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("text=scope%3Atypes+react");
  });

  it("works with scope only (no keywords)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([makePackageResult()])), { status: 200 }),
    );

    const items = await adapter.fetch({
      type: "npm",
      params: { scope: "anthropic" },
    });

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("npm:@anthropic");
  });

  it("applies sort=popularity by boosting popularity score weight", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await adapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "popularity" },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("popularity=1.0");
    expect(calledUrl).toContain("quality=0.0");
    expect(calledUrl).toContain("maintenance=0.0");
  });

  it("applies sort=quality by boosting quality score weight", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await adapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "quality" },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("quality=1.0");
    expect(calledUrl).toContain("popularity=0.0");
  });

  it("applies sort=maintenance by boosting maintenance score weight", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await adapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "maintenance" },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("maintenance=1.0");
    expect(calledUrl).toContain("popularity=0.0");
    expect(calledUrl).toContain("quality=0.0");
  });

  it("defaults to optimal sort (no weight params) for invalid sort", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await adapter.fetch({
      type: "npm",
      params: { keywords: ["react"], sort: "invalid" },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain("quality=");
    expect(calledUrl).not.toContain("popularity=");
    expect(calledUrl).not.toContain("maintenance=");
  });

  it("respects limit parameter", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await adapter.fetch({
      type: "npm",
      params: { keywords: ["test"], limit: 5 },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("size=5");
  });

  it("caps limit at 50", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(makeSearchResponse([])), { status: 200 }),
    );

    await adapter.fetch({
      type: "npm",
      params: { keywords: ["test"], limit: 200 },
    });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("size=50");
  });

  it("includes tags and repository in body", async () => {
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

    const items = await adapter.fetch({
      type: "npm",
      params: { keywords: ["react"] },
    });

    expect(items[0].body).toContain("tags: react, hooks, state, typescript, ui");
    expect(items[0].body).not.toContain("extra");
    expect(items[0].body).toContain("repo: https://github.com/x/x");
  });

  it("handles missing optional fields gracefully", async () => {
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

    const items = await adapter.fetch({
      type: "npm",
      params: { keywords: ["bare"] },
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("test-package — ");
    expect(items[0].body).not.toContain("by ");
    expect(items[0].body).not.toContain("tags:");
    expect(items[0].body).not.toContain("repo:");
  });

  it("throws on HTTP error with adapter prefix", async () => {
    fetchMock.mockResolvedValue(new Response("Rate limited", { status: 429 }));

    await expect(
      adapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
    ).rejects.toThrow("npm:");
  });

  it("throws on network error with adapter prefix", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      adapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
    ).rejects.toThrow("npm:");
  });

  it("uses errorMessage helper in !ok and network error paths per mmu/sh1", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");

    // HTTP !ok path (raw status in template before quality edit)
    fetchMock.mockResolvedValue(new Response("Rate limited", { status: 429 }));
    await expect(
      adapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
    ).rejects.toThrow("npm:");
    expect(emSpy).toHaveBeenCalledWith({ message: "429" });

    emSpy.mockClear();

    // network error path
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      adapter.fetch({ type: "npm", params: { keywords: ["test"] } }),
    ).rejects.toThrow("npm:");
    expect(emSpy).toHaveBeenCalled();

    emSpy.mockRestore();
  });
});
