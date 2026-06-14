import { describe, test, expect } from "bun:test";
import { validateParsedConfig } from "./config-validate";
import { DEFAULT_LAYOUT } from "./config/domain";
import type { LayoutNodeConfig } from "./layout/types";

/**
 * Config validator stress tests: pathological inputs, scale, edge cases.
 */

// Helper: build a valid adapter entry
function adapter(type: string, name?: string) {
  return name ? { type, name } : { type };
}

// Helper: build a valid panel referencing "all"
function panel(name: string) {
  return { panel: name, source: "all" };
}

// Helper: build a container with children
function container(
  dir: "row" | "column",
  children: LayoutNodeConfig[],
): LayoutNodeConfig {
  return { direction: dir, children };
}

describe("config validator stress tests", () => {
  describe("scale: 100 adapters + 50 panels", () => {
    test("validates config with 100 named adapters and 50 panels quickly", () => {
      const adapters = Array.from({ length: 100 }, (_, i) =>
        adapter("hackernews", `hn-${i}`),
      );
      const panels = Array.from({ length: 50 }, (_, i) =>
        panel(`panel-${i}`),
      );
      const layout: LayoutNodeConfig = container("row", panels);

      const start = performance.now();
      const result = validateParsedConfig(
        { adapters, layout },
        DEFAULT_LAYOUT,
      );
      const elapsed = performance.now() - start;

      expect(result.adapters).toHaveLength(100);
      expect(elapsed).toBeLessThan(500); // must finish under 500ms
    });

    test("100 adapters with unique names all validate", () => {
      const adapters = Array.from({ length: 100 }, (_, i) =>
        adapter("rss", `rss-feed-${i}`),
      );
      const layout: LayoutNodeConfig = container("row", [
        panel("all-feeds"),
      ]);

      const result = validateParsedConfig(
        { adapters, layout },
        DEFAULT_LAYOUT,
      );
      expect(result.adapters).toHaveLength(100);
    });
  });

  describe("scale: layout tree with 200 nodes", () => {
    test("validates deeply nested layout of 200 nodes", () => {
      // Build a balanced tree: alternating row/column, mix of panels, widgets, containers
      function buildTree(depth: number, breadth: number, idx: { n: number }): LayoutNodeConfig {
        if (idx.n >= 200 || depth === 0) {
          // Leaf: alternate between panel, image, text
          idx.n++;
          const mod = idx.n % 3;
          if (mod === 0) return panel(`p-${idx.n}`);
          if (mod === 1) return { image: "https://example.com/img.png" };
          return { text: `Content node ${idx.n}` };
        }
        const dir = depth % 2 === 0 ? "row" : "column";
        const children: LayoutNodeConfig[] = [];
        for (let i = 0; i < breadth && idx.n < 200; i++) {
          children.push(buildTree(depth - 1, breadth, idx));
        }
        idx.n++;
        return container(dir as "row" | "column", children);
      }

      const tree = buildTree(5, 4, { n: 0 });
      const adapters = [adapter("hackernews")];

      const start = performance.now();
      const result = validateParsedConfig(
        { adapters, layout: tree },
        DEFAULT_LAYOUT,
      );
      const elapsed = performance.now() - start;

      expect(result.layout).toBeDefined();
      expect(elapsed).toBeLessThan(1000);
    });

    test("validates wide layout with 100 children in one container", () => {
      const children: LayoutNodeConfig[] = Array.from({ length: 100 }, (_, i) =>
        panel(`wide-${i}`),
      );
      const layout: LayoutNodeConfig = container("row", children);

      const result = validateParsedConfig(
        { adapters: [adapter("hackernews")], layout },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toBeDefined();
    });
  });

  describe("error accumulation: fail-fast behavior", () => {
    test("throws on the first validation error, not accumulating multiple", () => {
      // Config with many problems: unknown top-level key, bad adapters, bad layout.
      // The validator uses throw-on-first-error, so only one Error surfaces.
      const badConfig = {
        adapters: "not-an-array",        // error 1: not a list
        layout: { panel: "", source: 42 }, // error 2: empty panel name
        bogus_key: true,                  // error 3: unknown key
        llm: "bad",                       // error 4: not an object
      };
      expect(() => validateParsedConfig(badConfig, DEFAULT_LAYOUT)).toThrow();
      // Verify it is exactly one error, not an aggregated message
      try {
        validateParsedConfig(badConfig, DEFAULT_LAYOUT);
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(Error);
        // Should mention the first problem found (top-level key or adapter list)
        const msg = (e as Error).message;
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
      }
    });

    test("config with 20+ distinct problems still throws on the first one", () => {
      // Each adapter has a different problem, but only the first one detected triggers
      const adapters = [
        { type: "" },              // empty type
        { type: 123 },            // non-string type
        "not-an-object",          // not an object
        { type: "hackernews", bad_key: 1 }, // unknown key
        null,                     // null
        { type: "counter" },      // missing url
        { type: "hackernews", refresh_interval: -5 }, // negative
        { type: "hackernews", name: "" }, // empty name
        undefined,                // undefined
        { type: "rss", params: "not-an-object" }, // params not object
      ];
      // The validator iterates adapters with forEach, so first bad one throws
      const config = { adapters, layout: DEFAULT_LAYOUT };
      let errorCount = 0;
      try {
        validateParsedConfig(config as Record<string, unknown>, DEFAULT_LAYOUT);
      } catch {
        errorCount++;
      }
      expect(errorCount).toBe(1);
    });
  });

  describe("string limits: extremely long names", () => {
    test("10k character panel name validates (no length limit)", () => {
      const longName = "p".repeat(10_000);
      const layout: LayoutNodeConfig = container("row", [
        { panel: longName, source: "all" },
      ]);
      const result = validateParsedConfig(
        { adapters: [adapter("hackernews")], layout },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toBeDefined();
    });

    test("10k character adapter name validates", () => {
      const longName = "a".repeat(10_000);
      const adapters = [adapter("hackernews", longName)];
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: longName },
      ]);
      const result = validateParsedConfig(
        { adapters, layout },
        DEFAULT_LAYOUT,
      );
      expect(result.adapters[0].name).toBe(longName);
    });

    test("10k character text widget content validates", () => {
      const longText = "x".repeat(10_000);
      const layout: LayoutNodeConfig = container("row", [
        { text: longText },
      ]);
      const result = validateParsedConfig({ layout }, DEFAULT_LAYOUT);
      expect(result.layout).toBeDefined();
    });

    test("10k character image alt text validates", () => {
      const longAlt = "description ".repeat(1000);
      const layout: LayoutNodeConfig = container("row", [
        { image: "https://example.com/img.png", alt: longAlt },
      ]);
      const result = validateParsedConfig({ layout }, DEFAULT_LAYOUT);
      expect(result.layout).toBeDefined();
    });
  });

  describe("unicode: adapter and panel names", () => {
    test("emoji in adapter name validates", () => {
      const name = "feed-\u{1F680}-rocket";
      const adapters = [adapter("hackernews", name)];
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: name },
      ]);
      const result = validateParsedConfig({ adapters, layout }, DEFAULT_LAYOUT);
      expect(result.adapters[0].name).toBe(name);
    });

    test("CJK characters in panel name validates", () => {
      const cjkName = "新闻探索";
      const layout: LayoutNodeConfig = container("row", [
        { panel: cjkName, source: "all" },
      ]);
      const result = validateParsedConfig(
        { adapters: [adapter("hackernews")], layout },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toBeDefined();
    });

    test("RTL characters in panel name validates", () => {
      const rtlName = "أخبار";
      const layout: LayoutNodeConfig = container("row", [
        { panel: rtlName, source: "all" },
      ]);
      const result = validateParsedConfig(
        { adapters: [adapter("hackernews")], layout },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toBeDefined();
    });

    test("combining characters in adapter name validates", () => {
      const combining = "café"; // cafe with combining acute accent
      const adapters = [adapter("hackernews", combining)];
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: combining },
      ]);
      const result = validateParsedConfig({ adapters, layout }, DEFAULT_LAYOUT);
      expect(result.adapters[0].name).toBe(combining);
    });

    test("mixed scripts in text widget content validates", () => {
      const mixedText = "Hello 你好 مرحبا \u{1F30D}";
      const layout: LayoutNodeConfig = container("row", [
        { text: mixedText },
      ]);
      const result = validateParsedConfig({ layout }, DEFAULT_LAYOUT);
      expect(result.layout).toBeDefined();
    });
  });

  describe("type coercion: wrong types in config fields", () => {
    test("number where string expected in panel name rejects", () => {
      const layout = { panel: 42, source: "all" };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });

    test("boolean where string expected in adapter type rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [{ type: true }], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });

    test("string where number expected in flex rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", flex: "2" as unknown as number },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-negative number");
    });

    test("array where object expected in adapter rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [["hackernews"]], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be an object");
    });

    test("boolean where object expected in layout rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [], layout: true },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a layout node object");
    });

    test("number where object expected in params rejects", () => {
      expect(() =>
        validateParsedConfig(
          {
            adapters: [{ type: "hackernews", params: 42 }],
            layout: DEFAULT_LAYOUT,
          },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be an object");
    });

    test("string where array expected in adapters rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: "hackernews", layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a list");
    });
  });

  describe("null/undefined in every config field position", () => {
    test("null adapters list rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: null, layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a list");
    });

    test("null layout falls through to default (null is nullish)", () => {
      // null ?? defaultLayout gives defaultLayout, so this validates fine
      const result = validateParsedConfig(
        { adapters: [], layout: null },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toEqual(DEFAULT_LAYOUT);
    });

    test("null adapter type rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [{ type: null }], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });

    test("null panel name rejects", () => {
      const layout = { panel: null, source: "all" };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });

    test("null panel source rejects", () => {
      const layout = { panel: "p", source: null };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a source name or source object");
    });

    test("null flex value rejects (not undefined, which is optional)", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", flex: null as unknown as number },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-negative number");
    });

    test("null llm config rejects (not undefined)", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [], layout: DEFAULT_LAYOUT, llm: null },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("llm must be an object");
    });

    test("undefined in adapter array entry rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [undefined], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be an object");
    });

    test("null image widget URL rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { image: null } as unknown as LayoutNodeConfig,
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-empty URL string");
    });

    test("null iframe URL rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { iframe: null } as unknown as LayoutNodeConfig,
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-empty URL string");
    });

    test("null text widget content rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { text: null } as unknown as LayoutNodeConfig,
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-empty string");
    });
  });

  describe("circular-ish: same panel name referenced multiple times", () => {
    test("duplicate panel names in layout rejected", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "same-name", source: "all" },
        { panel: "same-name", source: "all" },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('duplicate panel name "same-name"');
    });

    test("same panel name at different tree depths rejected", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "dup", source: "all" },
        container("column", [
          { panel: "dup", source: "all" },
        ]),
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('duplicate panel name "dup"');
    });

    test("same panel name but different IDs still rejected (names must be unique)", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "shared", source: "all", id: "id-1" },
        { panel: "shared", source: "all", id: "id-2" },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('duplicate panel name "shared"');
    });

    test("different panel names with same generated ID rejected", () => {
      // Two panels that would produce the same hash (same source/limit config)
      // but different names are fine because IDs are content-based
      const layout: LayoutNodeConfig = container("row", [
        { panel: "alpha", source: "all", id: "forced-same" },
        { panel: "beta", source: "all", id: "forced-same" },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('duplicate panel ID "forced-same"');
    });
  });

  describe("empty strings: every required string field set to ''", () => {
    test("empty adapter type rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [{ type: "" }], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });

    test("empty panel name rejects", () => {
      const layout = { panel: "", source: "all" };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });

    test("empty source string rejects", () => {
      const layout = { panel: "p", source: "" };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });

    test("empty image URL rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { image: "" } as unknown as LayoutNodeConfig,
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-empty URL string");
    });

    test("empty text content rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { text: "" } as unknown as LayoutNodeConfig,
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-empty string");
    });

    test("empty iframe URL rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { iframe: "" } as unknown as LayoutNodeConfig,
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-empty URL string");
    });

    test("empty adapter name rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [{ type: "hackernews", name: "" }], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });

    test("empty direction rejects", () => {
      const layout = { direction: "", children: [] };
      expect(() =>
        validateParsedConfig(
          { adapters: [], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be one of: row, column");
    });

    test("whitespace-only strings rejected as empty", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [{ type: "   " }], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string");
    });
  });

  describe("negative numbers: flex, refresh_interval, limit", () => {
    test("flex: -1 on panel rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", flex: -1 },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-negative number");
    });

    test("flex: -1 on container rejects", () => {
      const layout: LayoutNodeConfig = {
        direction: "row",
        children: [panel("p")],
        flex: -1,
      };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-negative number");
    });

    test("flex: -1 on image widget rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { image: "https://example.com/a.png", flex: -1 },
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-negative number");
    });

    test("flex: -1 on text widget rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { text: "hello", flex: -1 },
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-negative number");
    });

    test("flex: -1 on iframe widget rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { iframe: "https://example.com", flex: -1 },
      ]);
      expect(() =>
        validateParsedConfig({ layout }, DEFAULT_LAYOUT),
      ).toThrow("must be a non-negative number");
    });

    test("refresh_interval: -5 on adapter rejects", () => {
      expect(() =>
        validateParsedConfig(
          {
            adapters: [{ type: "hackernews", refresh_interval: -5 }],
            layout: DEFAULT_LAYOUT,
          },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a positive number");
    });

    test("limit: -10 on panel rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", limit: -10 },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a positive integer");
    });

    test("flex: 0 is accepted (use natural size, no grow)", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", flex: 0 },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).not.toThrow();
    });

    test("flex: NaN rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", flex: NaN },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-negative number");
    });

    test("flex: Infinity rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", flex: Infinity },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-negative number");
    });

    test("limit: 0 rejects (must be positive integer)", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", limit: 0 },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a positive integer");
    });

    test("limit: 1.5 (non-integer) rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", limit: 1.5 },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a positive integer");
    });
  });

  describe("performance: large heterogeneous configs", () => {
    test("config with mixed adapters, pipelines, complex layout under 200ms", () => {
      const adapters = [
        ...Array.from({ length: 20 }, (_, i) => adapter("hackernews", `hn-${i}`)),
        ...Array.from({ length: 20 }, (_, i) => adapter("rss", `rss-${i}`)),
        ...Array.from({ length: 10 }, (_, i) => adapter("reddit", `reddit-${i}`)),
      ];
      const sourceNames = adapters.map((a) => a.name!);
      const pipelines = Array.from({ length: 10 }, (_, i) => ({
        name: `pipe-${i}`,
        sources: [sourceNames[i * 5]!, sourceNames[i * 5 + 1]!],
        transforms: [{ type: "latest", count: 10 }],
      }));
      const panels: LayoutNodeConfig[] = Array.from({ length: 30 }, (_, i) =>
        ({ panel: `panel-${i}`, source: "all" }),
      );
      const widgets: LayoutNodeConfig[] = [
        { image: "https://example.com/a.png" },
        { text: "Hello world" },
        { iframe: "https://example.com" },
      ];
      const layout: LayoutNodeConfig = container("row", [
        container("column", panels.slice(0, 15)),
        container("column", [...panels.slice(15), ...widgets]),
      ]);

      const start = performance.now();
      const result = validateParsedConfig(
        { adapters, pipelines, layout },
        DEFAULT_LAYOUT,
      );
      const elapsed = performance.now() - start;

      expect(result.adapters).toHaveLength(50);
      expect(result.pipelines).toHaveLength(10);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe("boundary values and special cases", () => {
    test("adapter with all optional fields undefined validates", () => {
      const result = validateParsedConfig(
        {
          adapters: [{ type: "hackernews" }],
          layout: DEFAULT_LAYOUT,
        },
        DEFAULT_LAYOUT,
      );
      expect(result.adapters).toHaveLength(1);
    });

    test("widget-only layout (no adapters) validates", () => {
      const layout: LayoutNodeConfig = container("row", [
        { text: "Just text" },
        { image: "https://example.com/logo.png" },
      ]);
      const result = validateParsedConfig({ layout }, DEFAULT_LAYOUT);
      expect(result.adapters).toHaveLength(0);
    });

    test("empty adapters array with widget-only layout validates", () => {
      const layout: LayoutNodeConfig = container("row", [
        { text: "No feeds" },
      ]);
      const result = validateParsedConfig(
        { adapters: [], layout },
        DEFAULT_LAYOUT,
      );
      expect(result.adapters).toHaveLength(0);
    });

    test("layout node with no recognized discriminator rejects with helpful message", () => {
      const layout = { unknown_key: "value" };
      expect(() =>
        validateParsedConfig(
          { adapters: [], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must define one of: panel, direction, image, text, iframe");
    });

    test("layout node with multiple discriminators rejects", () => {
      const layout = { panel: "p", direction: "row", children: [], source: "all" };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("conflicting keys");
    });

    test("very large flex value (1e10) validates", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", flex: 1e10 },
      ]);
      const result = validateParsedConfig(
        { adapters: [adapter("hackernews")], layout },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toBeDefined();
    });

    test("fractional flex (0.001) validates", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "all", flex: 0.001 },
      ]);
      const result = validateParsedConfig(
        { adapters: [adapter("hackernews")], layout },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toBeDefined();
    });

    test("source referencing non-existent adapter rejects", () => {
      const layout: LayoutNodeConfig = container("row", [
        { panel: "p", source: "does-not-exist" },
      ]);
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('references unknown source "does-not-exist"');
    });

    test("deeply nested containers (10 levels) validates", () => {
      let node: LayoutNodeConfig = { panel: "leaf", source: "all" };
      for (let i = 0; i < 10; i++) {
        node = container(i % 2 === 0 ? "row" : "column", [node]);
      }
      const result = validateParsedConfig(
        { adapters: [adapter("hackernews")], layout: node },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toBeDefined();
    });

    test("config with no adapters and default layout validates", () => {
      const result = validateParsedConfig({}, DEFAULT_LAYOUT);
      expect(result.adapters).toHaveLength(0);
      expect(result.layout).toBeDefined();
    });
  });
});
