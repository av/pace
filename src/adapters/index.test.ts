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
});
