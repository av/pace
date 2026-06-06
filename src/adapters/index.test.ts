import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import {
  DISCOVERY_FILTER_NOISE,
  discoveryWarnsContaining,
  emptyAdapterFetch,
  expectInvalidDefaultExport,
  expectNoImportOrBadModWarnings,
  expectSkippedWithoutWarnings,
  mockAdapterDefault,
  mockAdapterModule,
  mockReaddir,
  mockReaddirThrows,
  readdirOnly,
  readdirWithRss,
} from "../test/adapter-discovery-mocks";
import { discoverAdapters } from "./index";
import type { AdapterConfig, ContentItem } from "./types";

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

  test("discovers adapters as Map with name and fetch", async () => {
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBeGreaterThanOrEqual(10);
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
    expect(adapters.has("types")).toBe(false);
    expect(adapters.has("index")).toBe(false);
  });

  test("normal discovery has no dup or load-fail warnings", async () => {
    await discoverAdapters();
    const dupWarnCalls = discoveryWarnsContaining(warnSpy, "duplicate adapter");
    const loadFailCalls = discoveryWarnsContaining(warnSpy, "failed to import");
    expect(dupWarnCalls.length).toBe(0);
    expect(loadFailCalls.length).toBe(0);
  });

  test("readdir failure returns empty Map and warns", async () => {
    mockReaddirThrows(new Error("readdir boom for direct edge test"));
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBe(0);
    const readdirWarns = discoveryWarnsContaining(warnSpy, "discoverAdapters: failed to read");
    expect(readdirWarns.length).toBe(1);
  });

  test("readdir filter and import error warn", async () => {
    const nonExistent = "nonexistent-direct-import-err-test-xyz.ts";
    mockReaddir(readdirWithRss(nonExistent));
    const adapters = await discoverAdapters();
    expect(adapters.has("rss")).toBe(true);
    expect(adapters.has("nonexistent-direct-import-err-test-xyz")).toBe(false);
    const loadFailCalls = discoveryWarnsContaining(warnSpy, "failed to import");
    expect(loadFailCalls.length).toBeGreaterThanOrEqual(1);
    expect(loadFailCalls[0] ?? "").toContain(nonExistent);
  });

  test.each([
    {
      label: "bad shape object",
      file: "badshape-direct-filter-26.ts",
      rejected: ["badshape-direct-filter-26"],
      readdir: (file: string) => readdirWithRss(file),
      setup(file: string) {
        mockAdapterDefault(file, { foo: "bad shape, no name/fetch fn" });
      },
    },
    {
      label: "missing default export",
      file: "nodefault-direct-34-edge.ts",
      rejected: ["nodefault-direct-34-edge"],
      readdir: (file: string) => readdirWithRss(file),
      setup(file: string) {
        mockAdapterModule(file, {});
      },
    },
    {
      label: "non-string name",
      file: "badnamenum-direct-35-edge.ts",
      rejected: ["123"],
      readdir: (file: string) => readdirWithRss(file),
      setup(file: string) {
        mockAdapterDefault(file, { name: 123, fetch: emptyAdapterFetch });
      },
    },
    {
      label: "whitespace-only name",
      file: "badnamews-direct-36-edge.ts",
      rejected: ["   ", ""],
      readdir: (file: string) => readdirWithRss(file),
      setup(file: string) {
        mockAdapterDefault(file, { name: "   ", fetch: emptyAdapterFetch });
      },
    },
    {
      label: "padded name",
      file: "paddedws-direct-50-edge.ts",
      rejected: [" padded-ngb-edge-50 ", "padded-ngb-edge-50"],
      readdir: (file: string) => readdirWithRss(file),
      setup(file: string) {
        mockAdapterDefault(file, { name: " padded-ngb-edge-50 ", fetch: emptyAdapterFetch });
      },
    },
    {
      label: "function default",
      file: "funcdefault-direct-51-edge.ts",
      rejected: ["func-default-ngb-edge-51"],
      readdir: (file: string) => readdirWithRss(file),
      setup(file: string) {
        function badFnDefault() {}
        Object.defineProperty(badFnDefault, "name", {
          value: "func-default-ngb-edge-51",
          writable: false,
          enumerable: true,
          configurable: true,
        });
        mockAdapterModule(file, { default: Object.assign(badFnDefault, { fetch: emptyAdapterFetch }) });
      },
    },
    {
      label: "class instance default",
      file: "classinst-direct-53-edge.ts",
      rejected: ["classinst-should-not-appear", "classinst-direct-53-edge"],
      readdir: (file: string) => readdirWithRss(file),
      setup(file: string) {
        mockAdapterModule(file, {
          default: (() => {
            class CIAdapter {
              name = "classinst-should-not-appear";
              async fetch(_config: AdapterConfig) {
                return [];
              }
            }
            return new CIAdapter();
          })(),
        });
      },
    },
    {
      label: "non-function fetch",
      file: "badfetch-direct-60-edge.ts",
      rejected: ["badfetch-should-not-appear"],
      accepted: ["good-adapter-ngb-60"],
      readdir: (file: string) => readdirWithRss(file, "good-adapter-edge-60.ts"),
      setup(file: string) {
        mockAdapterDefault(file, { name: "badfetch-should-not-appear", fetch: 42 });
        mockAdapterDefault("good-adapter-edge-60.ts", {
          name: "good-adapter-ngb-60",
          fetch: emptyAdapterFetch,
        });
      },
    },
    {
      label: "null default export",
      file: "nulldefault-direct-61-edge.ts",
      rejected: ["nulldefault-should-not-appear"],
      accepted: ["good-adapter-ngb-61"],
      readdir: (file: string) => readdirWithRss(file, "good-adapter-edge-61.ts"),
      setup(file: string) {
        mockAdapterModule(file, { default: null });
        mockAdapterDefault("good-adapter-edge-61.ts", {
          name: "good-adapter-ngb-61",
          fetch: emptyAdapterFetch,
        });
      },
    },
    {
      label: "null-proto object",
      file: "nullproto-direct-65-edge.ts",
      rejected: ["nullproto-should-not-appear"],
      accepted: ["good-adapter-ngb-65"],
      readdir: (file: string) => readdirWithRss(file, "good-adapter-ngb-65.ts"),
      setup(file: string) {
        const badNullProto = Object.create(null) as {
          name: string;
          fetch: (_config: AdapterConfig) => Promise<ContentItem[]>;
        };
        badNullProto.name = "nullproto-should-not-appear";
        badNullProto.fetch = emptyAdapterFetch;
        mockAdapterModule(file, { default: badNullProto });
        mockAdapterDefault("good-adapter-ngb-65.ts", {
          name: "good-adapter-ngb-65",
          fetch: emptyAdapterFetch,
        });
      },
    },
  ])("invalid default export: $label", async ({ file, rejected, accepted, readdir, setup }) => {
    setup(file);
    mockReaddir(readdir(file));
    const adapters = await discoverAdapters();
    expectInvalidDefaultExport(adapters, warnSpy, file, rejected, accepted ?? []);
  });

  test("duplicate adapter name warns, last wins", async () => {
    const dupName = "dup-adapter-edge-30";
    const f1 = "dup-edge-1-30.ts";
    const f2 = "dup-edge-2-30.ts";
    mockAdapterDefault(f1, { name: dupName, fetch: emptyAdapterFetch });
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
    expect(adapters.has(dupName)).toBe(true);
    const dups = discoveryWarnsContaining(warnSpy, "duplicate adapter");
    expect(dups.length).toBe(1);
    expect(dups[0] ?? "").toContain(dupName);
    expect(dups[0] ?? "").toContain("config source types");
  });

  test.each([
    {
      label: "dot-prefixed filename",
      file: ".dot-direct-52-edge.ts",
      rejected: ["dot-should-not-appear", ".dot-direct-52-edge"],
      readdir: () => readdirWithRss(".dot-direct-52-edge.ts"),
      setup() {
        mockAdapterDefault(".dot-direct-52-edge.ts", {
          name: "dot-should-not-appear",
          fetch: emptyAdapterFetch,
        });
      },
    },
    {
      label: "mixed-case TEST.ts",
      file: "leaky-test.TEST.ts",
      rejected: ["leaky-test-should-not-appear", "leaky-test.TEST"],
      readdir: () => readdirWithRss("leaky-test.TEST.ts"),
      setup() {
        mockAdapterDefault("leaky-test.TEST.ts", {
          name: "leaky-test-should-not-appear",
          fetch: emptyAdapterFetch,
        });
      },
    },
    {
      label: "mixed-case TEST.TS",
      file: "leaky-mixed-test-ts-72-edge.TEST.TS",
      rejected: ["leaky-mixed-test-ts-should-not-appear"],
      accepted: ["good-adapter-ngb-72"],
      readdir: () => readdirWithRss("good-adapter-edge-72.ts", "leaky-mixed-test-ts-72-edge.TEST.TS"),
      setup() {
        mockAdapterDefault("good-adapter-edge-72.ts", {
          name: "good-adapter-ngb-72",
          fetch: emptyAdapterFetch,
        });
        mockAdapterDefault("leaky-mixed-test-ts-72-edge.TEST.TS", {
          name: "leaky-mixed-test-ts-should-not-appear",
          fetch: emptyAdapterFetch,
        });
      },
    },
    {
      label: "mixed-case excluded module",
      file: "TYPES.TS",
      rejected: ["leaky-excluded-should-not-appear", "TYPES"],
      accepted: ["good-adapter-ngb-55"],
      readdir: () => readdirOnly("good-adapter-edge-55.ts", "TYPES.TS"),
      setup() {
        mockAdapterDefault("TYPES.TS", {
          name: "leaky-excluded-should-not-appear",
          fetch: emptyAdapterFetch,
        });
        mockAdapterDefault("good-adapter-edge-55.ts", {
          name: "good-adapter-ngb-55",
          fetch: emptyAdapterFetch,
        });
      },
    },
    {
      label: "d.ts declaration",
      file: "foo-direct-dts-56-edge.d.ts",
      rejected: ["leaky-dts-should-not-appear", "foo-direct-dts-56-edge"],
      accepted: ["good-adapter-ngb-56"],
      readdir: () => readdirOnly("good-adapter-edge-56.ts", "foo-direct-dts-56-edge.d.ts"),
      setup() {
        mockAdapterDefault("foo-direct-dts-56-edge.d.ts", {
          name: "leaky-dts-should-not-appear",
          fetch: emptyAdapterFetch,
        });
        mockAdapterDefault("good-adapter-edge-56.ts", {
          name: "good-adapter-ngb-56",
          fetch: emptyAdapterFetch,
        });
      },
    },
    {
      label: "mixed-case DTS",
      file: "leaky-mixed-dts-70-edge.D.TS",
      rejected: ["leaky-mixed-dts-should-not-appear"],
      accepted: ["good-adapter-ngb-70"],
      readdir: () => readdirWithRss("good-adapter-edge-70.ts", "leaky-mixed-dts-70-edge.D.TS"),
      setup() {
        mockAdapterDefault("good-adapter-edge-70.ts", {
          name: "good-adapter-ngb-70",
          fetch: emptyAdapterFetch,
        });
        mockAdapterDefault("leaky-mixed-dts-70-edge.D.TS", {
          name: "leaky-mixed-dts-should-not-appear",
          fetch: emptyAdapterFetch,
        });
      },
    },
    {
      label: "directory entry without .ts",
      file: "subdir-direct-57-edge",
      rejected: ["subdir-direct-57-edge", "good-adapter-edge-57"],
      accepted: ["good-adapter-ngb-57"],
      readdir: () => readdirOnly("good-adapter-edge-57.ts", "subdir-direct-57-edge"),
      setup() {
        mockAdapterDefault("good-adapter-edge-57.ts", {
          name: "good-adapter-ngb-57",
          fetch: emptyAdapterFetch,
        });
      },
    },
  ])("skips excluded source: $label", async ({ rejected, accepted, readdir, setup }) => {
    setup();
    mockReaddir(readdir());
    const adapters = await discoverAdapters();
    expectSkippedWithoutWarnings(adapters, warnSpy, rejected, accepted ?? []);
  });

  test.each([
    {
      label: "Dirent not a file",
      rejected: ["subdir-withfile-58-edge", "good-adapter-edge-58"],
      accepted: ["good-adapter-ngb-58"],
      setup() {
        mockAdapterDefault("good-adapter-edge-58.ts", {
          name: "good-adapter-ngb-58",
          fetch: emptyAdapterFetch,
        });
        mockReaddir(
          readdirOnly(
            { name: "subdir-withfile-58-edge", isFile: () => false, isDirectory: () => true },
            { name: "good-adapter-edge-58.ts", isFile: () => true, isDirectory: () => false }
          )
        );
      },
    },
    {
      label: "Dirent symlink",
      rejected: ["symlink-direct-59-edge", "good-adapter-edge-59"],
      accepted: ["good-adapter-ngb-59"],
      setup() {
        mockAdapterDefault("good-adapter-edge-59.ts", {
          name: "good-adapter-ngb-59",
          fetch: emptyAdapterFetch,
        });
        mockReaddir(
          readdirOnly(
            {
              name: "symlink-direct-59-edge.ts",
              isFile: () => false,
              isSymbolicLink: () => true,
              isDirectory: () => false,
            },
            {
              name: "good-adapter-edge-59.ts",
              isFile: () => true,
              isSymbolicLink: () => false,
              isDirectory: () => false,
            }
          )
        );
      },
    },
    {
      label: "dotfile Dirent",
      rejected: [".dotdirent-direct-66-edge", "dot-should-not-appear"],
      accepted: ["good-adapter-ngb-66"],
      setup() {
        mockAdapterDefault("good-adapter-edge-66.ts", {
          name: "good-adapter-ngb-66",
          fetch: emptyAdapterFetch,
        });
        mockReaddir([
          {
            name: ".dotdirent-direct-66-edge.ts",
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
          "rss.ts",
          {
            name: "good-adapter-edge-66.ts",
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          },
          ...DISCOVERY_FILTER_NOISE,
        ]);
      },
    },
    {
      label: "mixed-case DTS Dirent",
      rejected: ["leaky-mixed-dts-should-not-appear"],
      accepted: ["good-adapter-ngb-73"],
      setup() {
        mockAdapterDefault("good-adapter-edge-73.ts", {
          name: "good-adapter-ngb-73",
          fetch: emptyAdapterFetch,
        });
        mockReaddir([
          { name: "rss.ts", isFile: () => true },
          { name: "good-adapter-edge-73.ts", isFile: () => true },
          { name: "leaky-mixed-dts-73-edge.D.TS", isFile: () => true },
          ...DISCOVERY_FILTER_NOISE.map((f) => ({ name: f, isFile: () => true })),
        ]);
      },
    },
  ])("skips Dirent entry: $label", async ({ rejected, accepted, setup }) => {
    setup();
    const adapters = await discoverAdapters();
    expectSkippedWithoutWarnings(adapters, warnSpy, rejected, accepted ?? []);
  });

  test.each([
    { file: "good-mixedcase-ts-69.TS", name: "good-mixedcase-ts-69" },
    { file: "good-mixedcase-ts-dirent-71.TS", name: "good-mixedcase-ts-dirent-71", dirent: true },
  ])("accepts mixed-case TS: $file", async ({ file, name, dirent }) => {
    mockAdapterDefault(file, { name, fetch: emptyAdapterFetch });
    if (dirent) {
      mockReaddir([
        { name: "rss.ts", isFile: () => true },
        { name: file, isFile: () => true },
        ...DISCOVERY_FILTER_NOISE.map((f) => ({ name: f, isFile: () => true })),
      ]);
    } else {
      mockReaddir(readdirWithRss(file));
    }
    const adapters = await discoverAdapters();
    expect(adapters.has(name)).toBe(true);
    expectNoImportOrBadModWarnings(warnSpy);
  });

  test("string readdir compat discovers good and rejects bad shape", async () => {
    const stringGoodName = "stringonly-good-direct-62-edge.ts";
    const stringBadName = "stringonly-badshape-direct-62-edge.ts";
    mockAdapterDefault(stringBadName, { foo: "bad shape, no name/fetch fn" });
    mockAdapterDefault(stringGoodName, { name: "good-adapter-ngb-string-62", fetch: emptyAdapterFetch });
    mockReaddir(readdirWithRss(stringGoodName, stringBadName));
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-string-62")).toBe(true);
    expect(adapters.has("stringonly-badshape-direct-62-edge")).toBe(false);
    expectInvalidDefaultExport(adapters, warnSpy, stringBadName, []);
  });

  test.each([
    { goodFile: "internalws-good-direct-63-edge.ts", goodName: "internal-ws-adapter-ngb-63", badFile: "internalws-badshape-direct-63-edge.ts" },
    { goodFile: "space-good-direct-64-edge.ts", goodName: "good adapter with space 64", badFile: "space-badshape-direct-64-edge.ts" },
  ])("accepts valid name variant: $goodName", async ({ goodFile, goodName, badFile }) => {
    mockAdapterDefault(badFile, { foo: "bad shape, no name/fetch fn" });
    mockAdapterDefault(goodFile, { name: goodName, fetch: emptyAdapterFetch });
    mockReaddir(readdirWithRss(goodFile, badFile));
    const adapters = await discoverAdapters();
    expect(adapters.has(goodName)).toBe(true);
    expect(adapters.has(badFile.replace(/\.ts$/, ""))).toBe(false);
    expectInvalidDefaultExport(adapters, warnSpy, badFile, []);
  });

  test("mixed string and Dirent readdir compat", async () => {
    const mixedDirentGoodName = "good-mixed-d67-edge.ts";
    const mixedStringGoodName = "good-mixed-s67-edge.ts";
    const badMixedName = "bad-mixed-shape-67-edge.ts";
    mockAdapterDefault(badMixedName, { name: "bad-mixed-67", fetch: "not-a-fn" });
    mockAdapterDefault(mixedDirentGoodName, { name: "good-mixed-d67", fetch: emptyAdapterFetch });
    mockAdapterDefault(mixedStringGoodName, { name: "good-mixed-s67", fetch: emptyAdapterFetch });
    const direntMixedGood = {
      name: mixedDirentGoodName,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };
    mockReaddir([
      direntMixedGood,
      mixedStringGoodName,
      badMixedName,
      "rss.ts",
      ".dot-hidden-67.ts",
      ...DISCOVERY_FILTER_NOISE,
    ]);
    const adapters = await discoverAdapters();
    expect(adapters.has("good-mixed-d67")).toBe(true);
    expect(adapters.has("good-mixed-s67")).toBe(true);
    expect(adapters.has("bad-mixed-67")).toBe(false);
    expectInvalidDefaultExport(adapters, warnSpy, badMixedName, ["bad-mixed-67"]);
  });

  test("non-iterable readdir returns empty Map and warns", async () => {
    mockReaddir(null);
    const adapters = await discoverAdapters();
    expect(adapters).toBeInstanceOf(Map);
    expect(adapters.size).toBe(0);
    const readdirWarns = discoveryWarnsContaining(warnSpy, "non-iterable");
    expect(readdirWarns.length).toBe(1);
    expect(readdirWarns[0]).toContain("discoverAdapters:");
  });

  test("corrupt readdir entries skipped with warn", async () => {
    const goodName = "good-adapter-edge-74.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-74", fetch: emptyAdapterFetch });
    mockReaddir(
      readdirWithRss(
        goodName,
        42,
        null,
        { foo: "no-name-or-isfile" },
        { name: "bad-dirent-missing-isfile" }
      )
    );
    const adapters = await discoverAdapters();
    expect(adapters.has("good-adapter-ngb-74")).toBe(true);
    expect(adapters.has("bad-dirent-missing-isfile")).toBe(false);
    expectNoImportOrBadModWarnings(warnSpy);
    const badEntryWarns = discoveryWarnsContaining(warnSpy, "invalid readdir entry");
    expect(badEntryWarns.length).toBeGreaterThanOrEqual(1);
  });

  test("non-ts filenames filtered without extra warns", async () => {
    const goodName = "good-adapter-edge-75.ts";
    mockAdapterDefault(goodName, { name: "good-adapter-ngb-75", fetch: emptyAdapterFetch });
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
    expect(adapters.has("good-adapter-ngb-75")).toBe(true);
    expect(adapters.has("good-adapter-edge-75")).toBe(false);
    expectNoImportOrBadModWarnings(warnSpy);
    expect(discoveryWarnsContaining(warnSpy, "invalid readdir entry").length).toBe(0);
    expect(discoveryWarnsContaining(warnSpy, "duplicate adapter").length).toBe(0);
  });
});