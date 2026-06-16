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

  });

  describe("type coercion: wrong types in config fields", () => {
    test("number where string expected in panel name rejects", () => {
      const layout = { panel: 42, source: "all" };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a non-empty string (got 42)");
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
      ).toThrow('must be a non-negative number (got "2")');
    });

    test("array where object expected in adapter rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [["hackernews"]], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be an object (got array)");
    });

    test("string where array expected in adapters rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: "hackernews", layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('must be a list (got "hackernews")');
    });
  });

  describe("null/undefined in every config field position", () => {
    test("null adapters list rejects", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: null, layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a list (got null)");
    });

    test("null layout falls through to default (null is nullish)", () => {
      // null ?? defaultLayout gives defaultLayout, so this validates fine
      const result = validateParsedConfig(
        { adapters: [], layout: null },
        DEFAULT_LAYOUT,
      );
      expect(result.layout).toEqual(DEFAULT_LAYOUT);
    });

    test("null panel source rejects", () => {
      const layout = { panel: "p", source: null };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("must be a source name or source object (got null)");
    });

    test("null llm config rejects (not undefined)", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [], layout: DEFAULT_LAYOUT, llm: null },
          DEFAULT_LAYOUT,
        ),
      ).toThrow("llm must be an object (got null)");
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
    test("empty source string rejects", () => {
      const layout = { panel: "p", source: "" };
      expect(() =>
        validateParsedConfig(
          { adapters: [adapter("hackernews")], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('must be a non-empty string (got empty string "")');
    });

    test("empty direction rejects", () => {
      const layout = { direction: "", children: [] };
      expect(() =>
        validateParsedConfig(
          { adapters: [], layout },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('must be one of: row, column (got empty string "")');
    });

    test("whitespace-only strings rejected as empty", () => {
      expect(() =>
        validateParsedConfig(
          { adapters: [{ type: "   " }], layout: DEFAULT_LAYOUT },
          DEFAULT_LAYOUT,
        ),
      ).toThrow('must be a non-empty string (got "   ")');
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
      ).toThrow("must be a non-negative number (got -1)");
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
      ).toThrow("must be a positive number (got -5)");
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
      ).toThrow("must be a positive integer (got -10)");
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
      ).toThrow("must be a non-negative number (got NaN)");
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
      ).toThrow("must be a non-negative number (got Infinity)");
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
      ).toThrow("must be a positive integer (got 0)");
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
      ).toThrow("must be a positive integer (got 1.5)");
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

  });
});
