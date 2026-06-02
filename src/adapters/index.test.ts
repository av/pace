import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { discoverAdapters } from "./index";
import type { AdapterConfig, ContentItem } from "./types";

const emptyFetch = async (_config: AdapterConfig): Promise<ContentItem[]> => [];

describe("discoverAdapters", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn");
  });

  afterEach(() => {
    warnSpy.mockRestore();
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
    const dupWarnCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("duplicate adapter name")
    );
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(dupWarnCalls.length).toBe(0);
    expect(loadFailCalls.length).toBe(0);
  });

  test("skips bad modules and excluded files", async () => {
    const adapters = await discoverAdapters();
    expect(adapters.has("index")).toBe(false);
    expect(adapters.has("types")).toBe(false);
  });

  test("readdir failure returns empty Map and warns", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => { throw new Error("readdir boom for direct edge test"); },
    }));
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBe(0);
    const readdirWarns = warnSpy.mock.calls.filter((call) => String(call[0]).includes("readdir") || String(call[0]).includes("failed to read"));
    expect(readdirWarns.length).toBe(1);
    mock.restore();
  });

  test("readdir filter and import error warn", async () => {
    const nonExistent = "nonexistent-direct-import-err-test-xyz.ts";
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        nonExistent,
        "foo.test.ts",
        "types.ts",
        "bar.js",
        "index.ts",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("nonexistent-direct-import-err-test-xyz")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(loadFailCalls[0]?.[0] ?? "")).toContain(nonExistent);
    mock.restore();
  });

  test("bad shape default emits bad mod warn", async () => {
    const badName = "badshape-direct-filter-26.ts";
    const badAbs = "/home/everlier/code/pace/src/adapters/" + badName;
    mock.module(badAbs, () => ({
      default: { foo: "bad shape, no name/fetch fn" },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        badName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("badshape-direct-filter-26")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(badName);
    mock.restore();
  });

  test("import failure warns with import error phrase", async () => {
    const badImport = "nonexistent-direct-import-err-27-pure-test.ts";
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        badImport,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("nonexistent-direct-import-err-27-pure-test")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBeGreaterThanOrEqual(1);
    expect(String(loadFailCalls[0]?.[0] ?? "")).toContain(badImport);
    const importErrorWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("import error")
    );
    expect(importErrorWarns.length).toBe(1);
    expect(String(importErrorWarns[0]?.[0] ?? "")).toContain(badImport);
    mock.restore();
  });

  test("duplicate adapter name warns, last wins", async () => {
    const dupName = "dup-adapter-edge-30";
    const f1 = "dup-edge-1-30.ts";
    const f2 = "dup-edge-2-30.ts";
    const abs1 = "/home/everlier/code/pace/src/adapters/" + f1;
    const abs2 = "/home/everlier/code/pace/src/adapters/" + f2;
    mock.module(abs1, () => ({ default: { name: dupName, fetch: emptyFetch } }));
    mock.module(abs2, () => ({
      default: {
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
      },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [f1, f2, "rss.ts", "types.ts", "index.ts", "foo.test.ts"],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(dupName)).toBe(true);
    const dups = warnSpy.mock.calls.filter((c) => String(c[0]).includes("duplicate adapter name"));
    expect(dups.length).toBe(1);
    expect(String(dups[0]?.[0] ?? "")).toContain(dupName);
    expect(String(dups[0]?.[0] ?? "")).toContain("config names");
    mock.restore();
  });

  test("missing default export emits bad mod warn", async () => {
    const noDefName = "nodefault-direct-34-edge.ts";
    const absNo = "/home/everlier/code/pace/src/adapters/" + noDefName;
    mock.module(absNo, () => ({}));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        noDefName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(noDefName)).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(noDefName);
    mock.restore();
  });

  test("non-string name emits bad mod warn", async () => {
    const badNameFile = "badnamenum-direct-35-edge.ts";
    const absBad = "/home/everlier/code/pace/src/adapters/" + badNameFile;
    mock.module(absBad, () => ({
      default: { name: 123, fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        badNameFile,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(123)).toBe(false);
    expect(adapters.has("123")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(badNameFile);
    mock.restore();
  });

  test("whitespace-only name emits bad mod warn", async () => {
    const wsNameFile = "badnamews-direct-36-edge.ts";
    const absWs = "/home/everlier/code/pace/src/adapters/" + wsNameFile;
    mock.module(absWs, () => ({
      default: { name: "   ", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        wsNameFile,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("   ")).toBe(false);
    expect(adapters.has("")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(wsNameFile);
    mock.restore();
  });

  test("padded name emits bad mod warn", async () => {
    const paddedNameFile = "paddedws-direct-50-edge.ts";
    const absPadded = "/home/everlier/code/pace/src/adapters/" + paddedNameFile;
    mock.module(absPadded, () => ({
      default: { name: " padded-ngb-edge-50 ", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        paddedNameFile,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has(" padded-ngb-edge-50 ")).toBe(false);
    expect(adapters.has("padded-ngb-edge-50")).toBe(false);
    expect(adapters.has(" padded-ngb-edge-50".trim())).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(paddedNameFile);
    mock.restore();
  });

  test("function default emits bad mod warn", async () => {
    const fnDefName = "funcdefault-direct-51-edge.ts";
    const absFn = "/home/everlier/code/pace/src/adapters/" + fnDefName;
    function badFnDefault() {}
    Object.defineProperty(badFnDefault, "name", {
      value: "func-default-ngb-edge-51",
      writable: false,
      enumerable: true,
      configurable: true,
    });
    const badFnExport = Object.assign(badFnDefault, { fetch: emptyFetch });
    mock.module(absFn, () => ({ default: badFnExport }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        fnDefName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("func-default-ngb-edge-51")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(fnDefName);
    mock.restore();
  });

  test("dot-prefixed ts files are skipped", async () => {
    const dotName = ".dot-direct-52-edge.ts";
    const absDot = "/home/everlier/code/pace/src/adapters/" + dotName;
    mock.module(absDot, () => ({
      default: { name: "dot-should-not-appear", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        dotName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("dot-should-not-appear")).toBe(false);
    expect(adapters.has(".dot-direct-52-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("class instance default emits bad mod warn", async () => {
    const ciName = "classinst-direct-53-edge.ts";
    const absCi = "/home/everlier/code/pace/src/adapters/" + ciName;
    mock.module(absCi, () => ({
      default: (() => {
        class CIAdapter {
          name = "classinst-should-not-appear";
          async fetch(_config: AdapterConfig) { return []; }
        }
        return new CIAdapter();
      })(),
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        ciName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("classinst-should-not-appear")).toBe(false);
    expect(adapters.has("classinst-direct-53-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(ciName);
    mock.restore();
  });

  test("mixed-case TEST.ts test files are skipped", async () => {
    const leakyName = "leaky-test.TEST.ts";
    const absLeaky = "/home/everlier/code/pace/src/adapters/" + leakyName;
    mock.module(absLeaky, () => ({
      default: { name: "leaky-test-should-not-appear", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        leakyName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("leaky-test-should-not-appear")).toBe(false);
    expect(adapters.has("leaky-test.TEST")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("mixed-case excluded files are skipped", async () => {
    const exclName = "TYPES.TS";
    const absExcl = "/home/everlier/code/pace/src/adapters/" + exclName;
    const goodName = "good-adapter-edge-55.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absExcl, () => ({
      default: { name: "leaky-excluded-should-not-appear", fetch: emptyFetch },
    }));
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-55", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        goodName,
        exclName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-55")).toBe(true);
    expect(adapters.has("leaky-excluded-should-not-appear")).toBe(false);
    expect(adapters.has("TYPES")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("d.ts declaration files are skipped", async () => {
    const dtsName = "foo-direct-dts-56-edge.d.ts";
    const absDts = "/home/everlier/code/pace/src/adapters/" + dtsName;
    const goodName = "good-adapter-edge-56.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absDts, () => ({
      default: { name: "leaky-dts-should-not-appear", fetch: emptyFetch },
    }));
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-56", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        goodName,
        dtsName,
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
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("directory entries without ts extension are skipped", async () => {
    const dirName = "subdir-direct-57-edge";
    const goodName = "good-adapter-edge-57.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-57", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        goodName,
        dirName,
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
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("Dirent isFile skips non-files", async () => {
    const dirName = "subdir-withfile-58-edge";
    const goodName = "good-adapter-edge-58.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-58", fetch: emptyFetch },
    }));
    const direntDir = { name: dirName, isFile: () => false, isDirectory: () => true };
    const direntGood = { name: goodName, isFile: () => true, isDirectory: () => false };
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        direntDir,
        direntGood,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-58")).toBe(true);
    expect(adapters.has("subdir-withfile-58-edge")).toBe(false);
    expect(adapters.has("good-adapter-edge-58")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("symlink Dirent entries are skipped", async () => {
    const symName = "symlink-direct-59-edge.ts";
    const goodName = "good-adapter-edge-59.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-59", fetch: emptyFetch },
    }));
    const direntSym = { name: symName, isFile: () => false, isSymbolicLink: () => true, isDirectory: () => false };
    const direntGood = { name: goodName, isFile: () => true, isSymbolicLink: () => false, isDirectory: () => false };
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        direntSym,
        direntGood,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-59")).toBe(true);
    expect(adapters.has("symlink-direct-59-edge")).toBe(false);
    expect(adapters.has("good-adapter-edge-59")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("non-function fetch emits bad mod warn", async () => {
    const badFetchName = "badfetch-direct-60-edge.ts";
    const absBad = "/home/everlier/code/pace/src/adapters/" + badFetchName;
    mock.module(absBad, () => ({
      default: { name: "badfetch-should-not-appear", fetch: 42 },
    }));
    const goodName = "good-adapter-edge-60.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-60", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        badFetchName,
        goodName,
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
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(badFetchName);
    mock.restore();
  });

  test("null default export emits bad mod warn", async () => {
    const nullDefName = "nulldefault-direct-61-edge.ts";
    const absNull = "/home/everlier/code/pace/src/adapters/" + nullDefName;
    mock.module(absNull, () => ({
      default: null,
    }));
    const goodName = "good-adapter-edge-61.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-61", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        nullDefName,
        goodName,
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
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(nullDefName);
    mock.restore();
  });

  test("string-only readdir compat branch", async () => {
    const stringGoodName = "stringonly-good-direct-62-edge.ts";
    const absStringGood = "/home/everlier/code/pace/src/adapters/" + stringGoodName;
    const stringBadName = "stringonly-badshape-direct-62-edge.ts";
    const absStringBad = "/home/everlier/code/pace/src/adapters/" + stringBadName;
    mock.module(absStringBad, () => ({
      default: { foo: "bad shape, no name/fetch fn" },
    }));
    mock.module(absStringGood, () => ({
      default: { name: "good-adapter-ngb-string-62", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        stringGoodName,
        stringBadName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-string-62")).toBe(true);
    expect(adapters.has("stringonly-badshape-direct-62-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(stringBadName);
    mock.restore();
  });

  test("internal whitespace in name is accepted", async () => {
    const internalWsGoodName = "internalws-good-direct-63-edge.ts";
    const absInternalWsGood = "/home/everlier/code/pace/src/adapters/" + internalWsGoodName;
    const internalWsBadName = "internalws-badshape-direct-63-edge.ts";
    const absInternalWsBad = "/home/everlier/code/pace/src/adapters/" + internalWsBadName;
    mock.module(absInternalWsBad, () => ({
      default: { foo: "bad shape, no name/fetch fn" },
    }));
    mock.module(absInternalWsGood, () => ({
      default: { name: "internal-ws-adapter-ngb-63", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        internalWsGoodName,
        internalWsBadName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("internal-ws-adapter-ngb-63")).toBe(true);
    expect(adapters.has("internalws-badshape-direct-63-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(internalWsBadName);
    mock.restore();
  });

  test("embedded space in name is accepted", async () => {
    const spaceGoodName = "space-good-direct-64-edge.ts";
    const absSpaceGood = "/home/everlier/code/pace/src/adapters/" + spaceGoodName;
    const spaceBadName = "space-badshape-direct-64-edge.ts";
    const absSpaceBad = "/home/everlier/code/pace/src/adapters/" + spaceBadName;
    mock.module(absSpaceBad, () => ({
      default: { foo: "bad shape, no name/fetch fn" },
    }));
    mock.module(absSpaceGood, () => ({
      default: { name: "good adapter with space 64", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        spaceGoodName,
        spaceBadName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good adapter with space 64")).toBe(true);
    expect(adapters.has("space-badshape-direct-64-edge")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(spaceBadName);
    mock.restore();
  });

  test("null-proto object emits bad mod warn", async () => {
    const nullProtoName = "nullproto-direct-65-edge.ts";
    const absNullProto = "/home/everlier/code/pace/src/adapters/" + nullProtoName;
    const badNullProto = Object.create(null) as {
      name: string;
      fetch: (_config: AdapterConfig) => Promise<ContentItem[]>;
    };
    badNullProto.name = "nullproto-should-not-appear";
    badNullProto.fetch = emptyFetch;
    mock.module(absNullProto, () => ({
      default: badNullProto,
    }));
    const goodName = "good-adapter-ngb-65.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-65", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        nullProtoName,
        goodName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-65")).toBe(true);
    expect(adapters.has("nullproto-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(nullProtoName);
    mock.restore();
  });

  test("dotfile Dirent entries are skipped", async () => {
    const dotName = ".dotdirent-direct-66-edge.ts";
    const goodName = "good-adapter-edge-66.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-66", fetch: emptyFetch },
    }));
    const direntDot = { name: dotName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    const direntGood = { name: goodName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        direntDot,
        "rss.ts",
        direntGood,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-66")).toBe(true);
    expect(adapters.has(".dotdirent-direct-66-edge")).toBe(false);
    expect(adapters.has("dot-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("mixed string and Dirent readdir compat", async () => {
    const mixedDirentGoodName = "good-mixed-d67-edge.ts";
    const mixedStringGoodName = "good-mixed-s67-edge.ts";
    const badMixedName = "bad-mixed-shape-67-edge.ts";
    const absBadMixed = "/home/everlier/code/pace/src/adapters/" + badMixedName;
    mock.module(absBadMixed, () => ({
      default: { name: "bad-mixed-67", fetch: "not-a-fn" },
    }));
    const absMixedDirentGood = "/home/everlier/code/pace/src/adapters/" + mixedDirentGoodName;
    mock.module(absMixedDirentGood, () => ({
      default: { name: "good-mixed-d67", fetch: emptyFetch },
    }));
    const absMixedStringGood = "/home/everlier/code/pace/src/adapters/" + mixedStringGoodName;
    mock.module(absMixedStringGood, () => ({
      default: { name: "good-mixed-s67", fetch: emptyFetch },
    }));
    const direntMixedGood = { name: mixedDirentGoodName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        direntMixedGood,
        mixedStringGoodName,
        badMixedName,
        "rss.ts",
        ".dot-hidden-67.ts",
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixed-d67")).toBe(true);
    expect(adapters.has("good-mixed-s67")).toBe(true);
    expect(adapters.has("bad-mixed-67")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(1);
    expect(String(badModWarns[0]?.[0] ?? "")).toContain(badMixedName);
    mock.restore();
  });

  test("non-iterable readdir returns empty Map and warns", async () => {
    mock.module("node:fs/promises", () => ({
      readdir: async () => null,
    }));
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBe(0);
    const readdirWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to read adapters dir") || String(call[0]).includes("non-iterable")
    );
    expect(readdirWarns.length).toBe(1);
    expect(String(readdirWarns[0]?.[0] ?? "")).toContain("non-iterable");
    mock.restore();
  });

  test("accepts mixed-case TS extension", async () => {
    const goodTsName = "good-mixedcase-ts-69.TS";
    const absGoodTs = "/home/everlier/code/pace/src/adapters/" + goodTsName;
    mock.module(absGoodTs, () => ({
      default: { name: "good-mixedcase-ts-69", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        goodTsName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixedcase-ts-69")).toBe(true);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("excludes mixed-case DTS declarations", async () => {
    const dtsName = "leaky-mixed-dts-70-edge.D.TS";
    const absDts = "/home/everlier/code/pace/src/adapters/" + dtsName;
    const goodName = "good-adapter-edge-70.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-70", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        goodName,
        dtsName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-70")).toBe(true);
    expect(adapters.has("leaky-mixed-dts-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("accepts mixed-case TS via Dirent", async () => {
    const goodTsName = "good-mixedcase-ts-dirent-71.TS";
    const absGoodTs = "/home/everlier/code/pace/src/adapters/" + goodTsName;
    mock.module(absGoodTs, () => ({
      default: { name: "good-mixedcase-ts-dirent-71", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        { name: "rss.ts", isFile: () => true },
        { name: goodTsName, isFile: () => true },
        { name: "foo.test.ts", isFile: () => true },
        { name: "types.ts", isFile: () => true },
        { name: "index.ts", isFile: () => true },
        { name: "bar.js", isFile: () => true },
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-mixedcase-ts-dirent-71")).toBe(true);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("excludes mixed-case TEST.ts files", async () => {
    const testTsName = "leaky-mixed-test-ts-72-edge.TEST.TS";
    const absTestTs = "/home/everlier/code/pace/src/adapters/" + testTsName;
    const goodName = "good-adapter-edge-72.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-72", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        goodName,
        testTsName,
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-72")).toBe(true);
    expect(adapters.has("leaky-mixed-test-ts-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("excludes mixed-case DTS via Dirent", async () => {
    const dtsName = "leaky-mixed-dts-73-edge.D.TS";
    const absDts = "/home/everlier/code/pace/src/adapters/" + dtsName;
    const goodName = "good-adapter-edge-73.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-73", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        { name: "rss.ts", isFile: () => true },
        { name: goodName, isFile: () => true },
        { name: dtsName, isFile: () => true },
        { name: "foo.test.ts", isFile: () => true },
        { name: "types.ts", isFile: () => true },
        { name: "index.ts", isFile: () => true },
        { name: "bar.js", isFile: () => true },
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-73")).toBe(true);
    expect(adapters.has("leaky-mixed-dts-should-not-appear")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    mock.restore();
  });

  test("corrupt readdir entries skipped with warn", async () => {
    const goodName = "good-adapter-edge-74.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-74", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        goodName,
        42,
        null,
        { foo: "no-name-or-isfile" },
        { name: "bad-dirent-missing-isfile" },
        "foo.test.ts",
        "types.ts",
        "index.ts",
        "bar.js",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-74")).toBe(true);
    expect(adapters.has("bad-dirent-missing-isfile")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    const badEntryWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad readdir entry") || String(call[0]).includes("corrupt entry") || String(call[0]).includes("non string/Dirent")
    );
    expect(badEntryWarns.length).toBeGreaterThanOrEqual(1);
    mock.restore();
  });

  test("non-ts filenames filtered without extra warns", async () => {
    const goodName = "good-adapter-edge-75.ts";
    const absGood = "/home/everlier/code/pace/src/adapters/" + goodName;
    mock.module(absGood, () => ({
      default: { name: "good-adapter-ngb-75", fetch: emptyFetch },
    }));
    mock.module("node:fs/promises", () => ({
      readdir: async () => [
        "rss.ts",
        goodName,
        "bar.js",
        "subdir-noext",
        ".dot.ts",
        "foo.test.ts",
        "TYPES.TS",
        "index.ts",
      ],
    }));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("good-adapter-ngb-75")).toBe(true);
    expect(adapters.has("good-adapter-edge-75")).toBe(false);
    const loadFailCalls = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("failed to load adapter")
    );
    expect(loadFailCalls.length).toBe(0);
    const badModWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad mod filter") || String(call[0]).includes("non-conforming")
    );
    expect(badModWarns.length).toBe(0);
    const badEntryWarns = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("bad readdir entry")
    );
    expect(badEntryWarns.length).toBe(0);
    const anyDup = warnSpy.mock.calls.filter((c) => String(c[0]).includes("duplicate adapter name"));
    expect(anyDup.length).toBe(0);
    mock.restore();
  });
});
