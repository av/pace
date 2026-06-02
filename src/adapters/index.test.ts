import { join } from "node:path";
import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { discoverAdapters } from "./index";
import type { AdapterConfig, ContentItem } from "./types";

const ADAPTERS_DIR = import.meta.dir;
const FILTER_NOISE = ["foo.test.ts", "types.ts", "index.ts", "bar.js"] as const;

const emptyFetch = async (_config: AdapterConfig): Promise<ContentItem[]> => [];

function adapterModulePath(file: string): string {
  return join(ADAPTERS_DIR, file);
}

function mockAdapterModule(file: string, exports: Record<string, unknown>): void {
  mock.module(adapterModulePath(file), () => exports);
}

function mockReaddir(entries: unknown): void {
  mock.module("node:fs/promises", () => ({
    readdir: async () => entries,
  }));
}

function mockReaddirThrows(err: Error): void {
  mock.module("node:fs/promises", () => ({
    readdir: async () => {
      throw err;
    },
  }));
}

function readdirWithRss(...entries: unknown[]): unknown[] {
  return ["rss.ts", ...entries, ...FILTER_NOISE];
}

function readdirOnly(...entries: unknown[]): unknown[] {
  return [...entries, ...FILTER_NOISE];
}

function mockAdapterDefault(file: string, adapter: Record<string, unknown>): void {
  mockAdapterModule(file, { default: adapter });
}

function warnsContaining(spy: ReturnType<typeof spyOn>, fragment: string): string[] {
  return spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(fragment));
}

describe("discoverAdapters", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    warnSpy.mockClear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    mock.restore();
  });

  test("returns Map with adapters having name and fetch", async () => {
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBeGreaterThanOrEqual(10);
  });

  test("discovers expected adapter names", async () => {
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

  test("excludes types and index modules", async () => {
    const adapters = await discoverAdapters();
    expect(adapters.has("types")).toBe(false);
  });

  test("normal discovery has no dup or load-fail warnings", async () => {
    await discoverAdapters();
    const dupWarnCalls = warnsContaining(warnSpy, "duplicate adapter");
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(dupWarnCalls.length).toBe(0);
    expect(loadFailCalls.length).toBe(0);
  });

  test("skips bad modules and excluded files", async () => {
    const adapters = await discoverAdapters();
    expect(adapters.has("index")).toBe(false);
    expect(adapters.has("types")).toBe(false);
  });

  test("readdir failure returns empty Map and warns", async () => {
    mockReaddirThrows(new Error("readdir boom for direct edge test"));
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBe(0);
    const readdirWarns = warnsContaining(warnSpy, "discoverAdapters: failed to read");
    expect(readdirWarns.length).toBe(1);
  });

  test("readdir filter and import error warn", async () => {
    const nonExistent = "nonexistent-direct-import-err-test-xyz.ts";
    mockReaddir(readdirWithRss(nonExistent));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("nonexistent-direct-import-err-test-xyz")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBeGreaterThanOrEqual(1);
    expect(loadFailCalls[0] ?? "").toContain(nonExistent);
  });

  test("bad shape default emits bad mod warn", async () => {
    const badName = "badshape-direct-filter-26.ts";
    mockAdapterDefault(badName, { foo: "bad shape, no name/fetch fn" });
    mockReaddir(readdirWithRss(badName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("badshape-direct-filter-26")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(badName);
  });


  test("duplicate adapter name warns, last wins", async () => {
    const dupName = "dup-adapter-edge-30";
    const f1 = "dup-edge-1-30.ts";
    const f2 = "dup-edge-2-30.ts";
    mockAdapterDefault(f1, { name: dupName, fetch: emptyFetch });
    mockAdapterDefault(f2, {
      name: dupName,
      fetch: async (_config: AdapterConfig): Promise<ContentItem[]> => [
        {
          id: "last-wins",
          title: "dup",
          url: "https://example.com/last-wins",
          source: dupName,
          timestamp: new Date(0),
        },
      ],
    });
    mockReaddir([f1, f2, "rss.ts", "types.ts", "index.ts", "foo.test.ts"]);
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(dupName)).toBe(true);
    const dups = warnsContaining(warnSpy, "duplicate adapter");
    expect(dups.length).toBe(1);
    expect(dups[0] ?? "").toContain(dupName);
    expect(dups[0] ?? "").toContain("config source types");
  });

  test("missing default export emits bad mod warn", async () => {
    const noDefName = "nodefault-direct-34-edge.ts";
    mockAdapterModule(noDefName, {});
    mockReaddir(readdirWithRss(noDefName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(noDefName)).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(noDefName);
  });

  test("non-string name emits bad mod warn", async () => {
    const badNameFile = "badnamenum-direct-35-edge.ts";
    mockAdapterDefault(badNameFile, { name: 123, fetch: emptyFetch });
    mockReaddir(readdirWithRss(badNameFile));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(123)).toBe(false);
    expect(adapters.has("123")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(badNameFile);
  });

  test("whitespace-only name emits bad mod warn", async () => {
    const wsNameFile = "badnamews-direct-36-edge.ts";
    mockAdapterDefault(wsNameFile, { name: "   ", fetch: emptyFetch });
    mockReaddir(readdirWithRss(wsNameFile));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("   ")).toBe(false);
    expect(adapters.has("")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(wsNameFile);
  });

  test("padded name emits bad mod warn", async () => {
    const paddedNameFile = "paddedws-direct-50-edge.ts";
    mockAdapterDefault(paddedNameFile, { name: " padded-ngb-edge-50 ", fetch: emptyFetch });
    mockReaddir(readdirWithRss(paddedNameFile));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(" padded-ngb-edge-50 ")).toBe(false);
    expect(adapters.has("padded-ngb-edge-50")).toBe(false);
    expect(adapters.has(" padded-ngb-edge-50".trim())).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(paddedNameFile);
  });

  test("function default emits bad mod warn", async () => {
    const fnDefName = "funcdefault-direct-51-edge.ts";
    function badFnDefault() {}
    Object.defineProperty(badFnDefault, "name", {
      value: "func-default-ngb-edge-51",
      writable: false,
      enumerable: true,
      configurable: true,
    });
    const badFnExport = Object.assign(badFnDefault, { fetch: emptyFetch });
    mockAdapterModule(fnDefName, { default: badFnExport });
    mockReaddir(readdirWithRss(fnDefName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("func-default-ngb-edge-51")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(fnDefName);
  });

  test("dot-prefixed ts files are skipped", async () => {
    const dotName = ".dot-direct-52-edge.ts";
    mockAdapterDefault(dotName, { name: "dot-should-not-appear", fetch: emptyFetch });
    mockReaddir(readdirWithRss(dotName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("dot-should-not-appear")).toBe(false);
    expect(adapters.has(".dot-direct-52-edge")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("class instance default emits bad mod warn", async () => {
    const ciName = "classinst-direct-53-edge.ts";
    mockAdapterModule(ciName, {
      default: (() => {
        class CIAdapter {
          name = "classinst-should-not-appear";
          async fetch(_config: AdapterConfig) { return []; }
        }
        return new CIAdapter();
      })(),
    });
    mockReaddir(readdirWithRss(ciName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("classinst-should-not-appear")).toBe(false);
    expect(adapters.has("classinst-direct-53-edge")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(ciName);
  });

  test("mixed-case TEST.ts test files are skipped", async () => {
    const leakyName = "leaky-test.TEST.ts";
    mockAdapterDefault(leakyName, { name: "leaky-test-should-not-appear", fetch: emptyFetch });
    mockReaddir(readdirWithRss(leakyName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("leaky-test-should-not-appear")).toBe(false);
    expect(adapters.has("leaky-test.TEST")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("mixed-case excluded files are skipped", async () => {
    const exclName = "TYPES.TS";
    const goodName = "good-adapter-edge-55.ts";
    mockAdapterDefault(exclName, { name: "leaky-excluded-should-not-appear", fetch: emptyFetch });
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-55", fetch: emptyFetch });
    mockReaddir(readdirOnly(goodName, exclName));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-55")).toBe(true);
    expect(adapters.has("leaky-excluded-should-not-appear")).toBe(false);
    expect(adapters.has("TYPES")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("d.ts declaration files are skipped", async () => {
    const dtsName = "foo-direct-dts-56-edge.d.ts";
    const goodName = "good-adapter-edge-56.ts";
    mockAdapterDefault(dtsName, { name: "leaky-dts-should-not-appear", fetch: emptyFetch });
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-56", fetch: emptyFetch });
    mockReaddir(readdirOnly(goodName, dtsName));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-56")).toBe(true);
    expect(adapters.has("leaky-dts-should-not-appear")).toBe(false);
    expect(adapters.has("foo-direct-dts-56-edge")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("directory entries without ts extension are skipped", async () => {
    const dirName = "subdir-direct-57-edge";
    const goodName = "good-adapter-edge-57.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-57", fetch: emptyFetch });
    mockReaddir(readdirOnly(goodName, dirName));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-57")).toBe(true);
    expect(adapters.has("subdir-direct-57-edge")).toBe(false);
    expect(adapters.has("good-adapter-edge-57")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("Dirent isFile skips non-files", async () => {
    const dirName = "subdir-withfile-58-edge";
    const goodName = "good-adapter-edge-58.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-58", fetch: emptyFetch });
    const direntDir = { name: dirName, isFile: () => false, isDirectory: () => true };
    const direntGood = { name: goodName, isFile: () => true, isDirectory: () => false };
    mockReaddir(readdirOnly(direntDir, direntGood));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-58")).toBe(true);
    expect(adapters.has("subdir-withfile-58-edge")).toBe(false);
    expect(adapters.has("good-adapter-edge-58")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("symlink Dirent entries are skipped", async () => {
    const symName = "symlink-direct-59-edge.ts";
    const goodName = "good-adapter-edge-59.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-59", fetch: emptyFetch });
    const direntSym = { name: symName, isFile: () => false, isSymbolicLink: () => true, isDirectory: () => false };
    const direntGood = { name: goodName, isFile: () => true, isSymbolicLink: () => false, isDirectory: () => false };
    mockReaddir(readdirOnly(direntSym, direntGood));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-59")).toBe(true);
    expect(adapters.has("symlink-direct-59-edge")).toBe(false);
    expect(adapters.has("good-adapter-edge-59")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("non-function fetch emits bad mod warn", async () => {
    const badFetchName = "badfetch-direct-60-edge.ts";
    mockAdapterDefault(badFetchName, { name: "badfetch-should-not-appear", fetch: 42 });
    const goodName = "good-adapter-edge-60.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-60", fetch: emptyFetch });
    mockReaddir(readdirWithRss(badFetchName, goodName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-60")).toBe(true);
    expect(adapters.has("badfetch-should-not-appear")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(badFetchName);
  });

  test("null default export emits bad mod warn", async () => {
    const nullDefName = "nulldefault-direct-61-edge.ts";
    mockAdapterModule(nullDefName, { default: null });
    const goodName = "good-adapter-edge-61.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-61", fetch: emptyFetch });
    mockReaddir(readdirWithRss(nullDefName, goodName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-61")).toBe(true);
    expect(adapters.has("nulldefault-should-not-appear")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(nullDefName);
  });

  test("string-only readdir compat branch", async () => {
    const stringGoodName = "stringonly-good-direct-62-edge.ts";
    const stringBadName = "stringonly-badshape-direct-62-edge.ts";
    mockAdapterDefault(stringBadName, { foo: "bad shape, no name/fetch fn" });
    mockAdapterDefault(stringGoodName, { name: "good-adapter-ngb-string-62", fetch: emptyFetch });
    mockReaddir(readdirWithRss(stringGoodName, stringBadName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-string-62")).toBe(true);
    expect(adapters.has("stringonly-badshape-direct-62-edge")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(stringBadName);
  });

  test("internal whitespace in name is accepted", async () => {
    const internalWsGoodName = "internalws-good-direct-63-edge.ts";
    const internalWsBadName = "internalws-badshape-direct-63-edge.ts";
    mockAdapterDefault(internalWsBadName, { foo: "bad shape, no name/fetch fn" });
    mockAdapterDefault(internalWsGoodName, { name: "internal-ws-adapter-ngb-63", fetch: emptyFetch });
    mockReaddir(readdirWithRss(internalWsGoodName, internalWsBadName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("internal-ws-adapter-ngb-63")).toBe(true);
    expect(adapters.has("internalws-badshape-direct-63-edge")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(internalWsBadName);
  });

  test("embedded space in name is accepted", async () => {
    const spaceGoodName = "space-good-direct-64-edge.ts";
    const spaceBadName = "space-badshape-direct-64-edge.ts";
    mockAdapterDefault(spaceBadName, { foo: "bad shape, no name/fetch fn" });
    mockAdapterDefault(spaceGoodName, { name: "good adapter with space 64", fetch: emptyFetch });
    mockReaddir(readdirWithRss(spaceGoodName, spaceBadName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good adapter with space 64")).toBe(true);
    expect(adapters.has("space-badshape-direct-64-edge")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(spaceBadName);
  });

  test("null-proto object emits bad mod warn", async () => {
    const nullProtoName = "nullproto-direct-65-edge.ts";
    const badNullProto = Object.create(null) as {
      name: string;
      fetch: (_config: AdapterConfig) => Promise<ContentItem[]>;
    };
    badNullProto.name = "nullproto-should-not-appear";
    badNullProto.fetch = emptyFetch;
    mockAdapterModule(nullProtoName, { default: badNullProto });
    const goodName = "good-adapter-ngb-65.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-65", fetch: emptyFetch });
    mockReaddir(readdirWithRss(nullProtoName, goodName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-65")).toBe(true);
    expect(adapters.has("nullproto-should-not-appear")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(nullProtoName);
  });

  test("dotfile Dirent entries are skipped", async () => {
    const dotName = ".dotdirent-direct-66-edge.ts";
    const goodName = "good-adapter-edge-66.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-66", fetch: emptyFetch });
    const direntDot = { name: dotName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    const direntGood = { name: goodName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    mockReaddir([direntDot, "rss.ts", direntGood, ...FILTER_NOISE]);
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-66")).toBe(true);
    expect(adapters.has(".dotdirent-direct-66-edge")).toBe(false);
    expect(adapters.has("dot-should-not-appear")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("mixed string and Dirent readdir compat", async () => {
    const mixedDirentGoodName = "good-mixed-d67-edge.ts";
    const mixedStringGoodName = "good-mixed-s67-edge.ts";
    const badMixedName = "bad-mixed-shape-67-edge.ts";
    mockAdapterDefault(badMixedName, { name: "bad-mixed-67", fetch: "not-a-fn" });
    mockAdapterDefault(mixedDirentGoodName, { name: "good-mixed-d67", fetch: emptyFetch });
    mockAdapterDefault(mixedStringGoodName, { name: "good-mixed-s67", fetch: emptyFetch });
    const direntMixedGood = { name: mixedDirentGoodName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    mockReaddir([
      direntMixedGood,
      mixedStringGoodName,
      badMixedName,
      "rss.ts",
      ".dot-hidden-67.ts",
      ...FILTER_NOISE,
    ]);
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixed-d67")).toBe(true);
    expect(adapters.has("good-mixed-s67")).toBe(true);
    expect(adapters.has("bad-mixed-67")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(1);
    expect(badModWarns[0] ?? "").toContain(badMixedName);
  });

  test("non-iterable readdir returns empty Map and warns", async () => {
    mockReaddir(null);
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBe(0);
    const readdirWarns = warnsContaining(warnSpy, "non-iterable");
    expect(readdirWarns.length).toBe(1);
    expect(readdirWarns[0]).toContain("discoverAdapters:");
  });

  test("accepts mixed-case TS extension", async () => {
    const goodTsName = "good-mixedcase-ts-69.TS";
    mockAdapterDefault(goodTsName, { name: "good-mixedcase-ts-69", fetch: emptyFetch });
    mockReaddir(readdirWithRss(goodTsName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixedcase-ts-69")).toBe(true);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("excludes mixed-case DTS declarations", async () => {
    const dtsName = "leaky-mixed-dts-70-edge.D.TS";
    const goodName = "good-adapter-edge-70.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-70", fetch: emptyFetch });
    mockReaddir(readdirWithRss(goodName, dtsName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-70")).toBe(true);
    expect(adapters.has("leaky-mixed-dts-should-not-appear")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("accepts mixed-case TS via Dirent", async () => {
    const goodTsName = "good-mixedcase-ts-dirent-71.TS";
    mockAdapterDefault(goodTsName, { name: "good-mixedcase-ts-dirent-71", fetch: emptyFetch });
    mockReaddir([
      { name: "rss.ts", isFile: () => true },
      { name: goodTsName, isFile: () => true },
      ...FILTER_NOISE.map((f) => ({ name: f, isFile: () => true })),
    ]);
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixedcase-ts-dirent-71")).toBe(true);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("excludes mixed-case TEST.ts files", async () => {
    const testTsName = "leaky-mixed-test-ts-72-edge.TEST.TS";
    const goodName = "good-adapter-edge-72.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-72", fetch: emptyFetch });
    mockReaddir(readdirWithRss(goodName, testTsName));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-72")).toBe(true);
    expect(adapters.has("leaky-mixed-test-ts-should-not-appear")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("excludes mixed-case DTS via Dirent", async () => {
    const dtsName = "leaky-mixed-dts-73-edge.D.TS";
    const goodName = "good-adapter-edge-73.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-73", fetch: emptyFetch });
    mockReaddir([
      { name: "rss.ts", isFile: () => true },
      { name: goodName, isFile: () => true },
      { name: dtsName, isFile: () => true },
      ...FILTER_NOISE.map((f) => ({ name: f, isFile: () => true })),
    ]);
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-73")).toBe(true);
    expect(adapters.has("leaky-mixed-dts-should-not-appear")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
  });

  test("corrupt readdir entries skipped with warn", async () => {
    const goodName = "good-adapter-edge-74.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-74", fetch: emptyFetch });
    mockReaddir(readdirWithRss(
      goodName,
      42,
      null,
      { foo: "no-name-or-isfile" },
      { name: "bad-dirent-missing-isfile" },
    ));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-74")).toBe(true);
    expect(adapters.has("bad-dirent-missing-isfile")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
    const badEntryWarns = warnsContaining(warnSpy, "invalid readdir entry");
    expect(badEntryWarns.length).toBeGreaterThanOrEqual(1);
  });

  test("non-ts filenames filtered without extra warns", async () => {
    const goodName = "good-adapter-edge-75.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-75", fetch: emptyFetch });
    mockReaddir([
      "rss.ts",
      goodName,
      "bar.js",
      "subdir-noext",
      ".dot.ts",
      "foo.test.ts",
      "TYPES.TS",
      "index.ts",
    ]);
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-75")).toBe(true);
    expect(adapters.has("good-adapter-edge-75")).toBe(false);
    const loadFailCalls = warnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnsContaining(warnSpy, "invalid default export");
    expect(badModWarns.length).toBe(0);
    const badEntryWarns = warnsContaining(warnSpy, "invalid readdir entry");
    expect(badEntryWarns.length).toBe(0);
    const anyDup = warnsContaining(warnSpy, "duplicate adapter");
    expect(anyDup.length).toBe(0);
  });
});
