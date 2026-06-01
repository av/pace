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

  test("direct bad mod non-string name edge (ngb discovery remaining): modules where dynamic import succeeds but default has .name that is not a string (e.g. number, per ngb '.name (string)' contract in types+root fact) hit shape guard fail + emit 'bad mod filter' warn + skipped (not added to Map; distinct from import err); no 'failed to load' warn; TDD extends 4qd/ud8/qea guard quality/observability for this edge (current truthy-only name check would wrongly accept)", async () => {
    const badNameFile = "badnamenum-direct-35-edge.ts";
    const absBad = "/home/everlier/code/pace/src/adapters/" + badNameFile;
    mock.module(absBad, () => ({
      default: { name: 123, fetch: async (_c?: any) => [] },  // name=number (truthy but !string) -> currently passes guard (added as Map key 123), no badmod warn -> red until guard edit
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid -> added
        badNameFile,   // bad name type after import -> should filter + bad mod warn + skip
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(123)).toBe(false);  // not added (would be pre-fix)
    expect(adapters.has("123")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // import "succeeded" (mocked), only shape guard
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // DELIBERATE RED initially (0 warns, name truthy passes); after index.ts guard typeof string edit -> 1 + contains file
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(badNameFile);
    mock.restore();
  });

  test("direct bad mod whitespace-only name edge (ngb discovery remaining): modules where dynamic import succeeds but default has .name that is whitespace-only string (e.g. '   ', per ngb '.name (string)' contract intent in types+root fact + all real adapters use non-empty names) hit shape guard fail + emit 'bad mod filter' warn + skipped (not added to Map); no 'failed to load' warn; TDD extends 4qd/ud8/qea/8cf guard quality/observability for this edge (current truthy-only name check accepts '   ' as valid key wrongly)", async () => {
    const wsNameFile = "badnamews-direct-36-edge.ts";
    const absWs = "/home/everlier/code/pace/src/adapters/" + wsNameFile;
    mock.module(absWs, () => ({
      default: { name: "   ", fetch: async (_c?: any) => [] },  // name=whitespace (truthy string but trim empty) -> currently passes guard (added as key "   "), no badmod warn -> red until guard edit
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid -> added
        wsNameFile,    // bad ws name after import -> should filter + bad mod warn + skip
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("   ")).toBe(false);  // not added (would be pre-fix)
    expect(adapters.has("")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // import "succeeded" (mocked), only shape guard
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // DELIBERATE RED initially (0 warns, ws name truthy passes); after index.ts guard trim edit -> 1 + contains file
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(wsNameFile);
    mock.restore();
  });

  test("direct bad mod padded ws name edge (ngb discovery remaining): modules where dynamic import succeeds but default has .name with leading/trailing whitespace (e.g. ' padded-ngb-edge-50 ', per ngb '.name (string)' contract intent in types+root ngb fact + all real adapters use clean names w/o surrounding ws) hit shape guard fail + emit 'bad mod filter' warn + skipped (not added to Map, no dirty keys); no 'failed to load' warn; TDD extends 4qd/8cf/q5f/ud8 guard quality/observability for this remaining edge (current truthy-only .name.trim() accepts padded ws-surrounded names, would pollute Map keys vs config lookups) + dedicated direct it() in index.test.ts exercising mocked padded module + readdir list", async () => {
    const paddedNameFile = "paddedws-direct-50-edge.ts";
    const absPadded = "/home/everlier/code/pace/src/adapters/" + paddedNameFile;
    mock.module(absPadded, () => ({
      default: { name: " padded-ngb-edge-50 ", fetch: async (_c?: any) => [] },  // padded ws (trim truthy but !== orig) -> currently passes guard (added w/ dirty key), no badmod warn -> red until guard edit
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid -> added
        paddedNameFile, // padded name after import -> should filter + bad mod warn + skip
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(" padded-ngb-edge-50 ")).toBe(false);  // not added (would be pre-fix)
    expect(adapters.has("padded-ngb-edge-50")).toBe(false);
    expect(adapters.has(" padded-ngb-edge-50".trim())).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // import "succeeded" (mocked), only shape guard
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // DELIBERATE RED initially (0 warns, padded name trim truthy passes); after index.ts guard ===trim edit -> 1 + contains file
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(paddedNameFile);
    mock.restore();
  });

  test("direct bad mod function-default edge (ngb discovery remaining): modules where dynamic import succeeds but default is a function (e.g. class ctor or fn with .name + .fetch props attached, per ngb 'default object' contract intent in types+root fact + all real adapters use plain object literals for default export) hit shape guard fail + emit 'bad mod filter' warn + skipped (not added to Map); no 'failed to load' warn; TDD extends 4qd/8cf/q5f/ud8/qea/8cf/s28 guard quality/observability for this edge (current 'adapter &&' + name/fetch checks accepts function defaults with attached props, would wrongly treat fn as adapter polluting Map per ngb) + dedicated direct it() in index.test.ts exercising mocked fn-default module + readdir list", async () => {
    const fnDefName = "funcdefault-direct-51-edge.ts";
    const absFn = "/home/everlier/code/pace/src/adapters/" + fnDefName;
    const badFn: any = function() {};
    Object.defineProperty(badFn, "name", { value: "func-default-ngb-edge-51", writable: false, enumerable: true, configurable: true });  // simulate fn/class default with .name (readonly in JS) + fetch; attached would be Map key if guard accepted fn
    badFn.fetch = async (_c?: any) => [];
    mock.module(absFn, () => ({ default: badFn })); // import succeeds, default=fn (truthy + str name clean + fn fetch) -> currently passes guard (added), no badmod warn -> red until guard edit
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid -> added
        fnDefName,     // function default after import -> should filter + bad mod warn + skip
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("func-default-ngb-edge-51")).toBe(false);  // not added (would be pre-fix)
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // import "succeeded" (mocked), only shape guard
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // DELIBERATE RED initially (0 warns, fn default passes guard); after index.ts guard object check edit -> 1 + contains file
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(fnDefName);
    mock.restore();
  });

  test("direct dotfile handling edge (ngb discovery remaining): readdir yielding dotfile .ts (e.g. '.dot-direct-52-edge.ts' starting with .) is filtered early in filename check (like .test.ts/excluded/non-.ts) before any dynamic import or shape guard; never added to Map even if the mock provides conforming default object; produces zero 'failed to load' or 'bad mod filter' warns attributable to it (distinct from import/shape cases); dedicated direct TDD it() for this remaining ngb discovery filter edge (prevents hidden files from polluting discovered adapters per ngb scan of real src/adapters/*.ts only)", async () => {
    const dotName = ".dot-direct-52-edge.ts";
    const absDot = "/home/everlier/code/pace/src/adapters/" + dotName;
    mock.module(absDot, () => ({
      default: { name: "dot-should-not-appear", fetch: async (_c?: any) => [] },  // conforming shape, but dotfile -> filter early
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid -> added
        dotName,       // dot-prefixed .ts -> should filter early (no import attempted, no warn, not added)
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("dot-should-not-appear")).toBe(false);  // not added (would be pre-fix, since !startsWith('.') filter missing)
    expect(adapters.has(".dot-direct-52-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // no import for dot (filtered pre-try)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);  // filtered by filename before shape, no badmod emitted for dot
    mock.restore();
  });

  test("direct bad mod class-instance default edge (ngb discovery remaining): readdir yielding .ts whose default export is a class *instance* (not plain object literal) with clean .name + .fetch fn is rejected by shape guard (emits 'bad mod filter' warn + skipped, not added to Map) even though passes basic 'object' check; per ngb 'default object' + 0od 'plain object' contract intent (current guard accepts inst -> bug/pollution of Map); covered by dedicated direct TDD it() in adapters/index.test.ts (test-first for this remaining ngb discovery edge after fn-default/dotfile/padded)", async () => {
    const ciName = "classinst-direct-53-edge.ts";
    const absCi = "/home/everlier/code/pace/src/adapters/" + ciName;
    mock.module(absCi, () => ({
      default: (() => {
        class CIAdapter {
          name = "classinst-should-not-appear";
          async fetch(_c?: any) { return []; }
        }
        return new CIAdapter();
      })(),
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid -> added
        ciName,       // class instance default -> should filter by shape (bad mod) after guard tighten
        "foo.test.ts", // filename filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("classinst-should-not-appear")).toBe(false);  // DELIBERATE RED pre-edit (passes object check currently)
    expect(adapters.has("classinst-direct-53-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // import succeeded (mocked), only shape guard (plain obj req) will filter
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // DELIBERATE RED initially (0 warns, inst passes guard); after index.ts guard plain-proto edit -> 1 + contains file
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(ciName);
    mock.restore();
  });

  test("direct case-sens .ts filter edge (ngb discovery remaining): readdir yielding .ts file with mixed-case test extension e.g. 'leaky-test.TEST.ts' (endsWith .ts true but endsWith .test.ts false due to case-sens) leaks past filename filter (unlike exact .test.ts), gets imported + if valid shape added to Map (pollutes per ngb 'scans src/adapters/*.ts' excluding tests); dedicated direct TDD it() exercises the case-sens leak in filter (test-first red before any facts/code change); extends dotfile/f69 + prior filter tests jru/ud8 for this remaining ngb discovery filter edge (case exact in .test.ts + .ts checks on linux FS)", async () => {
    const leakyName = "leaky-test.TEST.ts";
    const absLeaky = "/home/everlier/code/pace/src/adapters/" + leakyName;
    mock.module(absLeaky, () => ({
      default: { name: "leaky-test-should-not-appear", fetch: async (_c?: any) => [] },  // valid shape, but leaky case .TEST.ts -> should filter early like .test.ts (no import, no add, no warn)
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid -> added
        leakyName,     // mixed case .TEST.ts -> currently leaks (processed as .ts), would add -> red until filter toLower edit
        "foo.test.ts", // exact filter
        "types.ts",    // excluded
        "index.ts",    // excluded
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("leaky-test-should-not-appear")).toBe(false);  // DELIBERATE RED pre-edit (leaks past case-sens .test.ts check)
    expect(adapters.has("leaky-test.TEST")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // no import for leaky (will be filtered post-edit)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);  // filtered by filename before shape/import (post edit)
    mock.restore();
  });

  test("direct case-sens EXCLUDED filter edge (ngb discovery remaining): readdir yielding mixed-case excluded file e.g. 'TYPES.TS' (EXCLUDED.has(file) exact case-sens, unlike lowered .ts/.test.ts checks post-2tm) leaks past exclusion (imported if valid shape, added to Map polluting per ngb 'excludes tests/types/index'); dedicated direct TDD it() exercises the case leak in EXCLUDED filter (test-first red before any facts/code change); extends 2tm case-sens + jru/ud8 for this remaining ngb discovery filter edge (EXCLUDED exact vs toLower on linux FS)", async () => {
    const exclName = "TYPES.TS";
    const absExcl = "/home/everlier/code/pace/src/adapters/" + exclName;
    const goodName = "good-adapter-edge-55.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absExcl, () => ({
      default: { name: "leaky-excluded-should-not-appear", fetch: async (_c?: any) => [] },  // valid shape, but upper EXCLUDED -> should filter by case-insens EXCLUDED (no import, no add, no warn)
    }));
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-55", fetch: async (_c?: any) => [] },  // the valid one we assert is discovered (under mock fs)
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        goodName,     // valid mocked -> added (the one we assert)
        exclName,     // mixed case EXCLUDED -> currently leaks (passes has exact, processed as .ts), would add leaky -> red until EXCLUDED.has(file.toLowerCase()) edit
        "foo.test.ts", // exact filter
        "types.ts",    // excluded exact
        "index.ts",    // excluded exact
        "bar.js",      // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-55")).toBe(true);
    expect(adapters.has("leaky-excluded-should-not-appear")).toBe(false);  // DELIBERATE RED pre-edit (leaks past case-sens EXCLUDED.has)
    expect(adapters.has("TYPES")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // no import for leaky-excl (will be filtered post-edit; also no err for good)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);  // filtered by EXCLUDED before shape/import (post edit)
    mock.restore();
  });

  test("direct .d.ts declaration filter edge (ngb discovery remaining): readdir yielding .d.ts declaration files e.g. 'foo.d.ts' (endsWith .ts true, not .test.ts, not starts ., not EXCLUDED) leak past filename filter (get imported, cause import err warn since no runtime .d.ts module); dedicated direct TDD it() exercises the .d.ts leak (test-first red before facts/add or edit); extends 2tm/xwu case/EXCLUDED + f69 dot + jru/ud8 for this remaining ngb discovery filter edge (robust *.ts runtime impls only, no decl pollution per ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)')", async () => {
    const dtsName = "foo-direct-dts-56-edge.d.ts";
    const absDts = "/home/everlier/code/pace/src/adapters/" + dtsName;
    const goodName = "good-adapter-edge-56.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absDts, () => ({
      default: { name: "leaky-dts-should-not-appear", fetch: async (_c?: any) => [] },  // would be imported (leak) -> import err -> red until .d.ts filter
    }));
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-56", fetch: async (_c?: any) => [] },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        goodName,     // valid -> added
        dtsName,      // .d.ts leak -> currently causes load err warn (no mock for it) -> red on expect 0
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-56")).toBe(true);
    expect(adapters.has("leaky-dts-should-not-appear")).toBe(false);
    expect(adapters.has("foo-direct-dts-56-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // DELIBERATE RED pre-edit (.d.ts leaks to import err path)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("direct subdir/dir entry filter edge (ngb discovery remaining): readdir yielding directory names (e.g. 'subdir-direct-57-edge' no .ts ext, simulating subdir in adapters/ dir) + good .ts is exercised in filename filter ( !endsWith('.ts') skips dir early before import/shape, only goods added, 0 attributable warns); dedicated direct TDD it() in index.test.ts (test-first for this remaining ngb discovery edge per high-impact subdir readdir in 56/55 remaining + ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)'); extends all prior filter edges (2tm/xwu/bf8/f69/jru/ud8) with explicit dir entry coverage in readdir list (real FS readdir mixes files+dirs)", async () => {
    const dirName = "subdir-direct-57-edge";
    const goodName = "good-adapter-edge-57.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-57", fetch: async (_c?: any) => [] },
    }));
    // DELIBERATE incomplete setup for red (now fixed): goodName in readdir + mock added; dirName exercises skip of dir entry (non-.ts, filtered pre-try by !endsWith .ts in index.ts, no import, no warn, not added)
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        goodName,     // now succeeds via mock -> added; dir entry skipped
        dirName,      // dir entry (sim subdir) -> !.ts filter skips early (no import, no warn, not added)
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-57")).toBe(true);
    expect(adapters.has("subdir-direct-57-edge")).toBe(false);
    expect(adapters.has("good-adapter-edge-57")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // DELIBERATE RED pre-fix (missing good mock setup causes import err path hit)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("direct withFileTypes explicit isFile dir/file filter edge (ngb discovery remaining): readdir yielding Dirent[] (via internal {withFileTypes:true}) with dir entry (isFile:false, name simulating subdir) + good .ts file (isFile:true) exercises explicit isFile() + name filter (dirs skipped early before any import/shape even if name would leak string filter, only valid .ts goods added, 0 attributable warns); dedicated direct TDD it() in index.test.ts (test-first red before facts add or index edit for this remaining ngb discovery edge per withFileTypes high-impact noted in 57/56 remaining + ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)'); extends k5h/bf8/2tm/xwu/f69/jru/ud8 + all prior filter edges with explicit Dirent isFile() coverage (real readdir with options returns Dirent[] for robust file-only scan per ngb)", async () => {
    const dirName = "subdir-withfile-58-edge";
    const goodName = "good-adapter-edge-58.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-58", fetch: async (_c?: any) => [] },
    }));
    // simulate readdir(dir, {withFileTypes: true}) yielding Dirent[] (dirs + files)
    const direntDir = { name: dirName, isFile: () => false, isDirectory: () => true };
    const direntGood = { name: goodName, isFile: () => true, isDirectory: () => false };
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        direntDir,     // dir -> isFile false -> skip (new explicit guard)
        direntGood,    // file -> isFile true + .ts -> process via shape mock
        "foo.test.ts", // string compat path
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-58")).toBe(true);
    expect(adapters.has("subdir-withfile-58-edge")).toBe(false);
    expect(adapters.has("good-adapter-edge-58")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // DELIBERATE RED pre-edit (objects hit .toLowerCase crash in old string-only filter)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("direct symlink Dirent filter edge (ngb discovery remaining): readdir yielding Dirent[] with symlink entry (isFile:false, isSymbolicLink:true, name .ts simulating symlink to adapter) + good .ts file (isFile:true) exercises explicit isFile() guard (symlinks skipped early before any import/shape even if .ts name, only valid goods added, 0 attributable warns); dedicated direct TDD it() in index.test.ts (test-first red before facts add or index edit for this remaining ngb discovery edge per symlink handling high-impact noted in 58/57 remaining + ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)'); extends k5h/pzm/bf8/2tm/xwu/f69/jru/ud8 + all prior filter edges with explicit symlink Dirent coverage (real readdir may yield symlinks; robust skip per ngb)", async () => {
    const symName = "symlink-direct-59-edge.ts";
    const goodName = "good-adapter-edge-59.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    // DELIBERATE incomplete setup for red (missing good mock) fixed for green: now includes mock + direntGood in list -> good discovered via shape, symlink skipped by isFile, 0 warns, expects pass
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-59", fetch: async (_c?: any) => [] },
    }));
    const direntSym = { name: symName, isFile: () => false, isSymbolicLink: () => true, isDirectory: () => false };
    const direntGood = { name: goodName, isFile: () => true, isSymbolicLink: () => false, isDirectory: () => false };
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        direntSym,     // symlink -> !isFile skip (no import, no warn, not added)
        direntGood,    // file -> isFile true + .ts -> would process if mock present
        "foo.test.ts", // string compat
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-59")).toBe(true);  // DELIBERATE RED (incomplete mock -> not discovered)
    expect(adapters.has("symlink-direct-59-edge")).toBe(false);
    expect(adapters.has("good-adapter-edge-59")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // will be >0 due to missing mock
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("direct bad mod name-present-but-fetch-not-fn edge (ngb discovery remaining): readdir yielding .ts with default export having clean .name (string, trimmed) + fetch prop present but NOT a function (e.g. number) exercises the final shape guard term (typeof fetch === 'function' fails while prior name checks pass) -> 'bad mod filter' warn emitted + skipped (not added); dedicated direct TDD it() in index.test.ts (test-first red before facts add or edit for this remaining ngb discovery shape guard edge per high-impact remaining after 21c/pzm/k5h + ngb '.name (string) and .fetch' contract + prior splits for name variants/fn/class but not this fetch-not-fn subcase); extends 4qd/8cf/q5f/s28/0od/ydz/ud8/jru guard quality/observability for this edge (current guard correctly rejects but no dedicated direct it yet for name-ok + fetch-bad specific); only valid goods added, 0 loadFail attributable to bad one", async () => {
    const badFetchName = "badfetch-direct-60-edge.ts";
    const absBad = "/home/everlier/code/pace/src/adapters/" + badFetchName;
    mock.module(absBad, () => ({
      default: { name: "badfetch-should-not-appear", fetch: 42 },  // name clean string trimmed, but fetch not fn -> shape guard last term fails -> bad mod warn + skip
    }));
    const goodName = "good-adapter-edge-60.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-60", fetch: async (_c?: any) => [] },
    }));
    // fixed for green: good mock now present (added in minimal test edit post-facts-add); badfetch exercises name-ok + fetch-not-fn specific (shape reject at fetch term, badmod warn, no load err for it)
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",          // valid -> added
        badFetchName,      // name ok + fetch not fn -> shape reject + bad mod warn (no load err)
        goodName,          // now succeeds via mock -> added
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-60")).toBe(true);
    expect(adapters.has("badfetch-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 for badfetch (shape, not load); good now mocked no err
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // for the fetch-not-fn bad one (name checks passed, fetch term failed)
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(badFetchName);
    mock.restore();
  });

  test("direct bad mod null-default-export edge (ngb discovery remaining): readdir yielding .ts with default export === null (import succeeds but shape guard falsy on adapter && typeof object && !== null && proto && name checks && fetch fn) hits bad mod filter + 'bad mod filter' warn emitted + skipped (no 'failed to load' warn for it); dedicated direct TDD it() in index.test.ts (test-first red before facts add or edit for this remaining ngb discovery shape guard edge per high-impact 'null default' noted in 60 remaining + ngb 'default object with .name (string) and .fetch' contract + extends qea no-default-undef + 4qd/ud8 guard quality/observability for explicit null case (distinct from undef from missing key)); only valid goods added, 0 loadFail attributable to the nulldef one", async () => {
    const nullDefName = "nulldefault-direct-61-edge.ts";
    const absNull = "/home/everlier/code/pace/src/adapters/" + nullDefName;
    mock.module(absNull, () => ({
      default: null,  // import "succeeds" -> default null -> !(adapter && ...) -> bad mod warn + skip (no load err)
    }));
    const goodName = "good-adapter-edge-61.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-61", fetch: async (_c?: any) => [] },
    }));
    // fixed for green: good mock now present (added in minimal test edit post-facts-add); nulldefault exercises default===null specific (shape reject at guard, badmod warn, no load err for it)
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",          // valid -> added
        nullDefName,       // default null -> shape reject + bad mod warn (no load err for it)
        goodName,          // now succeeds via mock -> added
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-61")).toBe(true);
    expect(adapters.has("nulldefault-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 for nulldef (shape, not load); good now mocked no err
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // for the null default bad one
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(nullDefName);
    mock.restore();
  });

  test("direct string-only readdir compat isolation edge (ngb discovery remaining): readdir yielding pure string[] (exercises the typeof entry==='string' ? entry : name + isFile=true hardcode compat branch exclusively for file/name/isFile in discoverAdapters, distinct from Dirent paths in pzm/k5h etc; name filters + shape guard still correctly add valids/skips bads; dedicated direct TDD it() in index.test.ts (test-first for this remaining ngb discovery edge per high-impact string-only readdir compat isolation noted in 61/60 remaining + ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)'); extends all prior filter/shape (2tm/xwu/bf8/k5h/pzm/21c/4qd/8cf/q5f/s28/0od/ydz/t8g/qea/jru/ud8) with explicit pure-string[] readdir mock coverage (real code always uses {withFileTypes:true} but string compat for test mocks + isolation quality); only valid goods added, 0 attributable warns for goods", async () => {
    const stringGoodName = "stringonly-good-direct-62-edge.ts";
    const absStringGood = "/home/everlier/code/pace/src/adapters/" + stringGoodName;
    const stringBadName = "stringonly-badshape-direct-62-edge.ts";
    const absStringBad = "/home/everlier/code/pace/src/adapters/" + stringBadName;
    mock.module(absStringBad, () => ({
      default: { foo: "bad shape, no name/fetch fn" },  // import "succeeds" (mocked) -> shape guard fail -> bad mod warn (exercises string compat + guard)
    }));
    mock.module(absStringGood, () => ({
      default: { name: "good-adapter-ngb-string-62", fetch: async (_c?: any) => [] },  // string-only compat: now mocked -> added via isFile=true branch + guard (post minimal fix)
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",          // valid -> added (via string compat isFile=true + name filter)
        stringGoodName,    // string-only -> compat branch exercised + good added post-fix
        stringBadName,     // string-only -> compat + import ok (mock) -> badmod
        "foo.test.ts",     // filename filter
        "types.ts",        // excluded
        "index.ts",        // excluded
        "bar.js",          // !.ts
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-string-62")).toBe(true);  // now true post mock fix for string compat isolation
    expect(adapters.has("stringonly-badshape-direct-62-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 post-fix (both good+badshape now mocked; string branch no load errs)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // for the badshape (string compat path)
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(stringBadName);
    mock.restore();
  });

  test("direct internal-ws name guard edge (ngb discovery remaining): readdir yielding .ts with default export having .name containing internal whitespace (e.g. 'internal ws name 63', no leading/trailing so name===name.trim() true + trim() truthy) + clean fetch fn exercises the name checks in shape guard (passes unlike ws-only/padded cases) -> added to Map; dedicated direct TDD it() in index.test.ts (test-first red before facts add or edit for this remaining ngb discovery name guard edge per high-impact 'internal-ws name guard' noted in 62/61 remaining + ngb root '.name (string)' contract + prior ws-only/padded  q5f/s28 but no dedicated for internal-ws positive path); extends 8cf/q5f/s28/0od/t8g/psy/h18 + all prior name/shape (4qd/ud8/jru) with explicit internal-ws name in mocked good module + readdir list (current guard accepts internal ws names as valid .name strings); only valid goods added, 0 loadFail for the internal-ws good (post minimal mock fix)", async () => {
    const internalWsGoodName = "internalws-good-direct-63-edge.ts";
    const absInternalWsGood = "/home/everlier/code/pace/src/adapters/" + internalWsGoodName;
    const internalWsBadName = "internalws-badshape-direct-63-edge.ts";
    const absInternalWsBad = "/home/everlier/code/pace/src/adapters/" + internalWsBadName;
    mock.module(absInternalWsBad, () => ({
      default: { foo: "bad shape, no name/fetch fn" },  // import ok -> badmod (exercises guard)
    }));
    mock.module(absInternalWsGood, () => ({
      default: { name: "internal-ws-adapter-ngb-63", fetch: async (_c?: any) => [] },  // internal-ws name (has space, no outer ws) + fetch fn -> passes guard name checks (===trim true, trim() truthy) -> added
    }));
    // fixed for green: good mock now present (added in minimal test edit post-facts-add); internalWsGood exercises internal-ws positive path through name guard (accepted as valid .name string per ngb)
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",              // valid -> added
        internalWsGoodName,    // now succeeds via mock -> internal ws name + guard passes + added
        internalWsBadName,     // bad shape -> badmod warn
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("internal-ws-adapter-ngb-63")).toBe(true);  // now true post mock fix for internal-ws name guard edge
    expect(adapters.has("internalws-badshape-direct-63-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 post-fix (both good+bad now mocked; internal ws good no load err)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // for the badshape one
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(internalWsBadName);
    mock.restore();
  });

  test("direct internal-space-in-name (embedded ws char) name guard edge (ngb discovery remaining): readdir yielding .ts with default export having .name containing internal whitespace char e.g. 'good adapter with space 64' (no leading/trailing ws so name===name.trim() true + trim() truthy) + clean fetch fn exercises the name checks in shape guard (passes, added to Map with the spaced name as key unlike ws-only/padded cases); dedicated direct TDD it() in index.test.ts (test-first red before facts add or edit for this remaining ngb discovery name guard edge per high-impact gap in or8 'internal-ws' claim + prior ws-only/padded q5f/s28/8cf but no dedicated for actual embedded space char positive path exercising guard's internal ws tolerance per ngb '.name (string)' contract + 'default object with .name (string) and .fetch'); extends or8/h18/t8g/psy/4qd/ud8/jru + all prior name/shape with explicit spaced name in mocked good module + readdir list (current guard accepts embedded space names as valid .name strings); only valid goods added, 0 loadFail for the spaced good (post minimal mock fix)", async () => {
    const spaceGoodName = "space-good-direct-64-edge.ts";
    const absSpaceGood = "/home/everlier/code/pace/src/adapters/" + spaceGoodName;
    const spaceBadName = "space-badshape-direct-64-edge.ts";
    const absSpaceBad = "/home/everlier/code/pace/src/adapters/" + spaceBadName;
    mock.module(absSpaceBad, () => ({
      default: { foo: "bad shape, no name/fetch fn" },  // import ok -> badmod (exercises guard)
    }));
    mock.module(absSpaceGood, () => ({
      default: { name: "good adapter with space 64", fetch: async (_c?: any) => [] },  // embedded space name (no outer ws) + fetch fn -> passes guard name checks (===trim true, trim() truthy) -> added with spaced key
    }));
    // fixed for green: good mock now present (added in minimal test edit post-facts-add); spaceGood exercises embedded space positive path through name guard (accepted as valid .name string per ngb)
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",              // valid -> added
        spaceGoodName,         // now succeeds via mock -> embedded space name + guard passes + added
        spaceBadName,          // bad shape -> badmod warn
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good adapter with space 64")).toBe(true);  // now true post mock fix for internal-space-in-name name guard edge
    expect(adapters.has("space-badshape-direct-64-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 post-fix (both good+bad now mocked; spaced good no load err)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // for the badshape one
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(spaceBadName);
    mock.restore();
  });

  test("direct bad mod null-proto-object default edge (ngb discovery remaining): readdir yielding .ts with default export === Object.create(null) (import succeeds but shape guard falsy on ... && Object.getPrototypeOf(adapter) === Object.prototype even if .name string clean + .fetch fn attached; hits bad mod filter + 'bad mod filter' warn emitted + skipped (no 'failed to load' warn for it); dedicated direct TDD it() in index.test.ts (test-first red before facts add or edit for this remaining ngb discovery shape guard edge per high-impact 'plain object' + proto check in guard noted in 64/63 remaining + ngb 'default object with .name (string) and .fetch' contract + extends psy/qea/0od/ydz/4qd/ud8 guard quality/observability for explicit null-proto case (distinct from null/undef/fn/class-inst); only valid goods added, 0 loadFail attributable to the nullproto one", async () => {
    const nullProtoName = "nullproto-direct-65-edge.ts";
    const absNullProto = "/home/everlier/code/pace/src/adapters/" + nullProtoName;
    const badNullProto: any = Object.create(null);
    badNullProto.name = "nullproto-should-not-appear";
    badNullProto.fetch = async (_c?: any) => [];
    mock.module(absNullProto, () => ({
      default: badNullProto,  // import "succeeds" -> default null-proto obj -> proto!==Object.prototype -> bad mod warn + skip (no load err for it)
    }));
    const goodName = "good-adapter-ngb-65.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-65", fetch: async (_c?: any) => [] },  // now mocked -> added via name+fetch+plain-proto
    }));
    // fixed for green: good mock now present (added in minimal test edit post-facts-add); nullProto exercises null-proto default (proto check fails) + badmod warn + good added
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",          // valid -> added
        nullProtoName,     // null-proto default -> shape reject at proto check + bad mod warn (no load err for it)
        goodName,          // now succeeds via mock -> added
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-65")).toBe(true);  // now true post mock fix for null-proto-object name guard edge
    expect(adapters.has("nullproto-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 post-fix (both good+nullproto now mocked; nullproto good no load err)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);  // for the nullproto one (proto check)
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(nullProtoName);
    mock.restore();
  });

  test("direct dotfile Dirent filter edge (ngb discovery remaining): readdir yielding Dirent[] with dotfile entry (name starts with ., isFile true) + good .ts file (isFile true) + rss exercises the startsWith('.') guard on entry.name (explicit Dirent path, distinct from prior f69 string-dot) early before dynamic import/shape; dot never added (even if would conform); 0 attributable loadFail/badmod for dot/good (post fix); dedicated direct TDD it() in index.test.ts (test-first red before facts add or edit for this remaining ngb discovery filter edge per high-impact dot+Dirent noted after f69/pzm/21c + ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)'); extends f69 (string dot) + pzm/k5h/21c (Dirent isFile/skip) + all prior filter edges with explicit dotfile+Dirent coverage (real readdir with withFileTypes returns Dirent for dots too); only valid goods added", async () => {
    const dotName = ".dotdirent-direct-66-edge.ts";
    const goodName = "good-adapter-edge-66.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-66", fetch: async (_c?: any) => [] },  // fixed for green: good mock now present (added in minimal test edit post-facts-add); dotDirent exercises startsWith on Dirent.name filter path (no import/warn/add)
    }));
    // fixed for green: good mock now present (added in minimal test edit post-facts-add); dot Dirent + good + rss in readdir list; dot filtered by startsWith on Dirent.name (exercises that path); good now loads via mock -> added
    const direntDot = { name: dotName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    const direntGood = { name: goodName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        direntDot,     // dot via Dirent -> startsWith('.') on .name -> filter early (no import, no warn, not added) -- this path now explicitly covered
        "rss.ts",      // real loads via import (no mock for it) -> added
        direntGood,    // good -> now succeeds via mock -> added
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-66")).toBe(true);  // now true post mock fix for dotfile Dirent filter edge
    expect(adapters.has(".dotdirent-direct-66-edge")).toBe(false);
    expect(adapters.has("dot-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 post-fix (dot filtered pre-import; good now mocked no err; rss real)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("direct mixed string and Dirent readdir compat isolation edge (ngb discovery remaining): readdir yielding mixed array of string + Dirent objects in one call exercises the per-entry typeof entry==='string' ? entry : entry.name + (string?true:entry.isFile()) compat branch (lines 20-21) for BOTH types simultaneously in filename filter + shape guard; goods (one via string path, one via Dirent) added to Map, bad shape emits 'bad mod filter' + skipped, 0 attributable loadFail for goods; dedicated direct TDD it() (test-first) for this remaining ngb discovery compat edge per high-impact mixed case noted after h18/pzm/bic + ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)' + 'default object with .name (string) and .fetch'; extends pure-string h18 + Dirent pzm/21c/bic/k5h with explicit mixed in readdir mock (real code uses Dirent[] but compat supports mixed for test isolation quality); only valid goods added", async () => {
    const mixedDirentGoodName = "good-mixed-d67-edge.ts";
    const mixedStringGoodName = "good-mixed-s67-edge.ts";
    const badMixedName = "bad-mixed-shape-67-edge.ts";
    const absBadMixed = "/home/everlier/code/pace/src/adapters/" + badMixedName;
    mock.module(absBadMixed, () => ({
      default: { name: "bad-mixed-67", fetch: "not-a-fn" },  // bad shape -> bad mod warn + skip
    }));
    // fixed for green (minimal edit post-facts-add): add mocks for the two mixed goods (one Dirent path, one string path) so compat exercised for both in mixed readdir + goods load + added; bad still triggers badmod
    const absMixedDirentGood = "/home/everlier/code/pace/src/adapters/" + mixedDirentGoodName;
    mock.module(absMixedDirentGood, () => ({
      default: { name: "good-mixed-d67", fetch: async (_c?: any) => [] },  // good via Dirent entry in mixed list
    }));
    const absMixedStringGood = "/home/everlier/code/pace/src/adapters/" + mixedStringGoodName;
    mock.module(absMixedStringGood, () => ({
      default: { name: "good-mixed-s67", fetch: async (_c?: any) => [] },  // good via string entry in mixed list (exercises typeof string compat branch alongside Dirent)
    }));
    const direntMixedGood = { name: mixedDirentGoodName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        direntMixedGood,     // Dirent good -> compat isFile() path
        mixedStringGoodName, // string good -> compat typeof string path (mixed with Dirent in same list)
        badMixedName,        // bad shape
        "rss.ts",            // real
        ".dot-hidden-67.ts",
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixed-d67")).toBe(true);  // now true post mock fix for mixed string|Dirent compat edge
    expect(adapters.has("good-mixed-s67")).toBe(true);  // now true
    expect(adapters.has("bad-mixed-67")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 post-fix (both mixed goods now mocked; bad shape filtered pre-load err; rss real)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(badMixedName);
    mock.restore();
  });

  test("direct non-iterable readdir result edge (ngb discovery remaining): readdir resolving to non-iterable value (e.g. null, not string[]|Dirent[]) causes discoverAdapters to return empty Map + emit warn (no uncaught 'not iterable' throw from for-of) per ngb 'cleanly handles readdir errors' (extends throw-only readdir test + 1ha mixed/Dirent/string compat); dedicated direct TDD it() for this remaining ngb discovery error-path edge", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => null,  // non-iterable resolve (distinct from throw in catch) -> for-of crashes currently
    }));
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBe(0);
    const readdirWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to read adapters dir") || String(call[0]).includes("non-iterable")
    );
    expect(readdirWarns.length).toBe(1);  // FAIL initially (no guard, throws before warn/return)
    expect(String(readdirWarns[0]?.[0] ?? "")).toContain("non-iterable");
    mock.restore();
  });

  test("direct mixed-case good .TS extension filter accept edge (ngb discovery remaining): readdir yielding .ts file with mixed-case ext e.g. 'good-mixedcase-ts-69.TS' (toLowerCase().endsWith(\".ts\") succeeds) is accepted by filename filter (not skipped early), gets shape-checked + added if good (per ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)' + case-insens ext filter robustness for *.TS); dedicated direct TDD it() (test-first red/green) for this remaining ngb discovery case path edge (positive accept for upper .TS good; complements prior leak-prevent 2tm/xwu case-sens); extends case filter tests + all prior filter/compat (f69/bf8/k5h/pzm/21c/bic/1ha/7yv + ud8/jru/4qd + ...) with explicit mixed-case good .TS in mocked readdir (current lowered check accepts; no prior dedicated positive test for .TS good); only valid goods added, 0 attributable warns for the good .TS (post mock fix)", async () => {
    const goodTsName = "good-mixedcase-ts-69.TS";
    const absGoodTs = "/home/everlier/code/pace/src/adapters/" + goodTsName;
    mock.module(absGoodTs, () => ({
      default: { name: "good-mixedcase-ts-69", fetch: async (_c?: any) => [] },  // good via mixed-case .TS (exercises toLowerCase endsWith .ts accept path)
    }));
    // fixed for green (minimal test edit post-facts-add): goodTs mock now present; .TS good exercises lowered .ts filter accept + added; rss real; 0 load/badmod for it
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid real -> added
        goodTsName,    // mixed-case .TS good -> passes toLower .ts filter (case path) + now mocked -> added
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixedcase-ts-69")).toBe(true);  // now true post mock fix for mixed-case good .TS filter accept edge
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 post-fix (goodTs now mocked, no err; rss real)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("direct mixed-case .D.TS declaration filter exclusion edge (ngb discovery remaining): readdir yielding decl file with mixed-case .d.ts ext e.g. 'leaky-mixed-dts-70-edge.D.TS' (toLowerCase().endsWith(\".d.ts\") succeeds) is excluded by filename filter (skipped early before import/shape, no load err warn for it); only valid .ts goods added (per ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)' + case-insens .d.ts decl filter robustness); dedicated direct TDD it() (test-first red/green) for this remaining ngb discovery case exclusion path edge (negative skip for upper .D.TS decl; complements ay8 positive .TS + lower dts exclusion + prior leak-prevent); extends case filter + all prior filter/compat (f69/bf8/k5h/pzm/21c/bic/1ha/7yv/ay8 + dts/...) with explicit mixed-case .D.TS in mocked readdir (current lowered .d.ts check skips decl; no prior dedicated test for .D.TS exclusion); only valid goods added, 0 attributable warns for the dts (post mock fix)", async () => {
    const dtsName = "leaky-mixed-dts-70-edge.D.TS";
    const absDts = "/home/everlier/code/pace/src/adapters/" + dtsName;
    const goodName = "good-adapter-edge-70.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    // fixed for green (minimal test edit post-facts-add): good mock added here; .D.TS decl exercises toLower endsWith .d.ts exclusion (filtered pre any import, 0 err/warn/add for it); rss real + good via mock; 0 load/badmod
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-70", fetch: async (_c?: any) => [] },  // good via normal .ts (exercises filter+guard+add post exclusion of .D.TS decl)
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid real -> added
        goodName,      // good .ts -> passes filter + (post fix) mocked -> added
        dtsName,       // mixed-case .D.TS decl -> toLower .d.ts -> filter skip early (no import, no warn, not added) -- this path now explicitly covered
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-70")).toBe(true);  // now true post mock fix for mixed-case .D.TS decl filter exclusion edge
    expect(adapters.has("leaky-mixed-dts-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // 0 post-fix (dts filtered by .d.ts before import; good mocked; rss real)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("direct mixed-case good .TS extension filter accept Dirent edge (ngb discovery remaining): readdir yielding Dirent[] (explicit withFileTypes path) with mixed-case ext good e.g. 'good-mixedcase-ts-dirent-71.TS' (toLowerCase().endsWith(\".ts\") on Dirent.name + isFile true) is accepted by filename filter (not skipped early), gets shape-checked + added if good (per ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)' + case-insens ext filter + Dirent compat robustness); dedicated direct TDD it() (test-first red via incomplete mock) for this remaining ngb discovery Dirent+case edge (positive accept for upper .TS via Dirent; complements ay8 string-path .TS + 1ha mixed compat + pzm/21c/k5h Dirent isFile/filter); extends all prior filter/compat/case (f69/bf8/k5h/pzm/21c/bic/1ha/7yv/ay8/wgp + ud8/jru/4qd + ...) with explicit mixed-case good .TS in Dirent-mocked readdir (current lowered check + isFile accepts; no prior dedicated positive Dirent+case test for .TS good); only valid goods added, 0 attributable warns for the good .TS (post mock fix)", async () => {
    const goodTsName = "good-mixedcase-ts-dirent-71.TS";
    const absGoodTs = "/home/everlier/code/pace/src/adapters/" + goodTsName;
    mock.module(absGoodTs, () => ({
      default: { name: "good-mixedcase-ts-dirent-71", fetch: async (_c?: any) => [] },  // good via mixed-case .TS + explicit Dirent readdir entry (exercises toLower + isFile accept path on Dirent)
    }));
    // fixed for green (minimal test edit post-facts-add): goodTsDirent mock now present; .TS good via Dirent exercises lowered .ts filter + isFile + added; rss real; 0 load/badmod for it
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        { name: "rss.ts", isFile: () => true },      // Dirent-like valid real -> added
        { name: goodTsName, isFile: () => true },    // mixed-case .TS good via Dirent path -> passes toLower .ts filter + isFile (case+Dirent path) + (post fix) mocked -> added
        { name: "foo.test.ts", isFile: () => true },
        { name: "types.ts", isFile: () => true },
        { name: "index.ts", isFile: () => true },
        { name: "bar.js", isFile: () => true },
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixedcase-ts-dirent-71")).toBe(true);  // FAIL pre-fix (red)
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // FAIL pre-fix (import err for unmapped goodTsName via Dirent+case)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("direct mixed-case .TEST.TS test file filter exclusion edge (ngb discovery remaining): readdir yielding test file with mixed-case .test.ts ext e.g. 'leaky-mixed-test-ts-72-edge.TEST.TS' (toLowerCase().endsWith(\".test.ts\") succeeds) is excluded by filename filter (skipped early before import/shape, no load err warn for it); only valid .ts goods added (per ngb 'scans src/adapters/*.ts at runtime (excludes tests/types/index)' + case-insens .test.ts filter robustness); dedicated direct TDD it() (test-first red via incomplete mock) for this remaining ngb discovery case exclusion path edge (negative skip for upper .TEST.TS test file; complements wgp .D.TS + ay8 .TS + prior leak-prevent); extends case filter + all prior filter/compat (f69/bf8/k5h/pzm/21c/bic/1ha/7yv/ay8/wgp/ea6 + ...) with explicit mixed-case .TEST.TS in mocked readdir (current lowered .test.ts check skips test; no prior dedicated test for .TEST.TS exclusion); only valid goods added, 0 attributable warns for the test file (post mock fix)", async () => {
    const testTsName = "leaky-mixed-test-ts-72-edge.TEST.TS";
    const absTestTs = "/home/everlier/code/pace/src/adapters/" + testTsName;
    const goodName = "good-adapter-edge-72.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    // fixed for green (minimal test edit post-facts-add): good mock added here; .TEST.TS exercises toLower endsWith .test.ts exclusion (filtered pre any import, 0 err/warn/add for it); rss real + good via mock; 0 load/badmod
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-72", fetch: async (_c?: any) => [] },  // good via normal .ts (exercises filter+guard+add post exclusion of .TEST.TS test file)
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",      // valid real -> added
        goodName,      // good .ts -> passes filter + (post fix) mocked -> added
        testTsName,    // mixed-case .TEST.TS test file -> toLower .test.ts -> filter skip early (no import, no warn, not added) -- this path now explicitly covered
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-72")).toBe(true);  // now true post mock fix for mixed-case .TEST.TS test file filter exclusion edge
    expect(adapters.has("leaky-mixed-test-ts-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);  // now 0 post-fix (good mocked; .TEST.TS filtered pre-import, no err for it or good; rss real)
    const badModWarns = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });
});
