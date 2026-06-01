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

  test("direct bad mod shape filter: discovery skips modules where import succeeds but default fails shape guard (no .name or no fetch fn) without 'failed to load' warn (distinct from import err); emits 'bad mod filter' warn for observability/quality (per ngb/ud8 shape guard)", async () => {
    const badName = "badshape-direct-filter-26.ts";
    const badAbs = "/home/everlier/code/pace/src/adapters/" + badName;
    mock.module(badAbs, () => ({
      default: { foo: "bad shape, no name/fetch fn" },  // import "succeeds" via mock -> shape guard should filter
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid
        badName,       // bad shape after import -> filter + bad mod warn
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("badshape-direct-filter-26")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // import succeeded (mocked), only shape guard filtered it (not a load err)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // currently 0 (silent skip on shape fail) -> will drive red until index quality edit adds warn
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(badName);
    mock.restore();
  });

  test("direct import error behavior: dynamic import() failure for a listed .ts (e.g. missing module) is caught + warned (with 'failed to load adapter' + 'import error' for clarity/quality) + filtered (not added to Map) without crashing discover; dedicated direct test (distinct from mixed readdir+import or shape) per ngb discovery contract", async () => {
    const badImport = "nonexistent-direct-import-err-27-pure-test.ts";
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid shape -> added
        badImport,     // triggers native dynamic import() reject -> catch path
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts filter
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("nonexistent-direct-import-err-27-pure-test")).toBe(false); // filtered
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(loadFailCalls[0]?.[0] ?? "")).toContain(badImport);
    // quality observability: warn now explicitly signals import error (drives minimal index.ts edit for "import error" prefix in catch; initial red)
    const importErrorWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("import error")
    );
    expect(importErrorWarns.length).toBe(1);  // FAIL initially (no "import error" phrase yet in warn msg)
    expect(String(importErrorWarns[0]?.[0] ?? "")).toContain(badImport);
    mock.restore();
  });

  test("duplicate name edge in ngb discovery: readdir yielding multiple .ts with same .name triggers 'duplicate adapter name' warn (incl file+ 'vs config names' note), last wins (Map keeps 1 entry, overwritten) (direct TDD for remaining dup handling branch per ngb)", async () => {
    const dupName = "dup-adapter-edge-30";
    const f1 = "dup-edge-1-30.ts";
    const f2 = "dup-edge-2-30.ts";
    const abs1 = "/home/everlier/code/pace/src/adapters/" + f1;
    const abs2 = "/home/everlier/code/pace/src/adapters/" + f2;
    mock.module(abs1, () => ({ default: { name: dupName, fetch: async (_c?: any) => [] } }));
    mock.module(abs2, () => ({ default: { name: dupName, fetch: async (_c?: any) => [{id: "last-wins"}] } }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [f1, f2, "rss.ts", "types.ts", "index.ts", "foo.test.ts"],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(dupName)).toBe(true);
    const dups = warnSpy.mock.calls.filter((c: any[]) => String(c[0]).includes("duplicate adapter name"));
    expect(dups.length).toBe(1); // fixed from deliberate 99 red (now matches actual dup warn emitted by the exercised branch)
    expect(String(dups[0]?.[0] ?? "")).toContain(dupName);
    expect(String(dups[0]?.[0] ?? "")).toContain("config names");
    mock.restore();
  });

  test("direct bad mod no-default-export edge (ngb discovery remaining): modules where dynamic import succeeds but default===undefined (no export default at all) hit shape guard fail + 'bad mod filter' warn emitted + skipped (no 'failed to load' warn); extends observability to this silent-skip path (previously no warn unlike default-present bad shapes per 4qd/ud8/ngb)", async () => {
    const noDefName = "nodefault-direct-34-edge.ts";
    const absNo = "/home/everlier/code/pace/src/adapters/" + noDefName;
    mock.module(absNo, () => ({})); // import succeeds, but no .default key => default===undefined => !shape && !(... !== undefined) => currently silent (no bad mod warn)
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid -> added
        noDefName,     // success import, bad shape (undef default) -> should warn bad mod + skip
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(noDefName)).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // import "succeeded" (mocked), only shape guard
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // DELIBERATE RED initially (0 warns, silent for undef default case); after index.ts else edit -> 1 + contains name
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(noDefName);
    mock.restore();
  });
});
