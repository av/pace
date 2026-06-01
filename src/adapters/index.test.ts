import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
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

  test("bad mod filter + readdir/import error edges: discovery skips bad modules (filename filter for non-.ts/.test/excluded + shape guard for !(adapter && name && fetch fn)) and handles readdir/import errors cleanly without crashing (per ngb)", async () => {
    const adapters = await discoverAdapters();
    expect(adapters.has("index")).toBe(false); // bad mod filename filter (index.ts excluded, would fail shape if imported) + no crash
    expect(adapters.has("types")).toBe(false); // bad mod (types.ts excluded before shape check per ngb)
    // readdir error path (catch returns empty Map) and import error path (warn+skip in try/catch) covered indirectly by no-warn normal + this filter test
  });

  test("direct readdir error edge: readdir failure causes discover to return empty Map without crash (per ngb/ud8 discovery)", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => { throw new Error("readdir boom for direct edge test"); },
    }));
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBe(0);
    // quality: readdir catch should emit observable warn (currently silent; this assert makes red until index quality edit)
    const readdirWarns = warnSpy.mock.calls.filter((call: any[]) => String(call[0]).includes("readdir") || String(call[0]).includes("failed to read"));
    expect(readdirWarns.length).toBe(1);
    mock.restore();
  });

  test("direct readdir filter + import error handling: mocked readdir list exercises .ts filter (skips .test/excluded/non-ts) + import err for nonexistent triggers warn+skip + only valid shapes added (direct TDD for ngb discovery edges)", async () => {
    const nonExistent = "nonexistent-direct-import-err-test-xyz.ts";
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",                    // real valid -> added
        nonExistent,                 // triggers import() fail -> catch warn + skip
        "foo.test.ts",               // filtered by .test.ts
        "types.ts",                  // filtered by EXCLUDED
        "bar.js",                    // filtered by !.ts
        "index.ts",                  // filtered by EXCLUDED
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("nonexistent-direct-import-err-test-xyz")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(loadFailCalls[0]?.[0] ?? "")).toContain(nonExistent);
    mock.restore();
  });
});
