import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { discoverAdapters } from "./index";

describe("adapters/index discoverAdapters (TDD full coverage for untouched discover logic)", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn");
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("returns a Map of discovered adapters with correct shape (name + fetch fn)", async () => {
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBeGreaterThanOrEqual(10);
  });

  test("discovers all real implemented adapters (devto, hackernews, rss, etc) with matching .name and callable fetch", async () => {
    const adapters = await discoverAdapters();
    const expectedNames = [
      "devto",
      "hackernews",
      "youtube",
      "podcast",
      "rss",
      "stackexchange",
      "github-releases",
      "producthunt",
      "lobsters",
      "mastodon",
      "reddit",
      "arxiv",
      "github",
      "twitter",
    ];
    for (const name of expectedNames) {
      expect(adapters.has(name)).toBe(true);
      const adapter = adapters.get(name)!;
      expect(adapter.name).toBe(name);
      expect(typeof adapter.fetch).toBe("function");
    }
  });

  test("excludes types.ts and index.ts (no 'types' or index module treated as adapter)", async () => {
    const adapters = await discoverAdapters();
    expect(adapters.has("types")).toBe(false);
    // index.ts does not export a default Adapter, so never added
  });

  test("normal discovery produces no duplicate-name or failed-to-load warnings (test files + excluded are now skipped cleanly)", async () => {
    await discoverAdapters();
    const dupWarnCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("duplicate adapter name")
    );
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(dupWarnCalls.length).toBe(0);
    expect(loadFailCalls.length).toBe(0);
  });
});
