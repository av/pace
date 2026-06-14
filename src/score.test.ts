import { describe, test, expect, spyOn } from "bun:test";
import * as piAi from "@mariozechner/pi-ai";
import { installTempDbHooks } from "./test/temp-db";
import { initDb, replacePanelItems, getAllItemsByPanel, getDb } from "./db";
import { makeContentItemRow as makeRow } from "./test/content-items";
import { runPipeline } from "./transforms";

const fakeModel = { id: "fake" } as piAi.Model<piAi.Api>;

// ── 1. Score column migration ────────────────────────────────────────────────

describe("score column", () => {
  installTempDbHooks({ prefix: "pace-score-", init: false, warnOnRmFail: true });

  test("initDb migration adds score column", () => {
    initDb();
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(content_items)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("score");
  });

  test("migration is idempotent - initDb twice does not throw with score column", () => {
    initDb();
    expect(() => initDb()).not.toThrow();
  });

  // ── 2. Score persists through replacePanelItems ──────────────────────────

  test("replacePanelItems persists score on rows that have it", () => {
    initDb();
    const item = makeRow({ id: "scored-1", score: 8.5 });
    replacePanelItems("test-panel", [item]);

    const db = getDb();
    const row = db.prepare("SELECT score FROM content_items WHERE id = ?").get("scored-1") as { score: number | null };
    expect(row).not.toBeNull();
    expect(row.score).toBe(8.5);
  });

  test("replacePanelItems stores null score when not set", () => {
    initDb();
    const item = makeRow({ id: "unscored-1", score: null });
    replacePanelItems("test-panel", [item]);

    const db = getDb();
    const row = db.prepare("SELECT score FROM content_items WHERE id = ?").get("unscored-1") as { score: number | null };
    expect(row.score).toBeNull();
  });

  test("getAllItemsByPanel returns score column value", () => {
    initDb();
    const item = makeRow({ id: "scored-2", score: 7.2 });
    replacePanelItems("test-panel", [item]);

    const rows = getAllItemsByPanel("test-panel");
    expect(rows.length).toBe(1);
    expect(rows[0].score).toBe(7.2);
  });

  test("score field survives round-trip with origins and applied_transforms", () => {
    initDb();
    const item = makeRow({
      id: "full-row",
      score: 9,
      origins: '["hn","lobsters"]',
      applied_transforms: '["llm-rank"]',
    });
    replacePanelItems("test-panel", [item]);

    const [row] = getAllItemsByPanel("test-panel");
    expect(row.score).toBe(9);
    expect(row.origins).toBe('["hn","lobsters"]');
    expect(row.applied_transforms).toBe('["llm-rank"]');
  });
});

// ── 3. llm-rank writes score onto rows ──────────────────────────────────────

describe("llm-rank scores", () => {
  test("llm-rank attaches score to each row and sorts by score descending", async () => {
    const completeSpy = spyOn(piAi, "complete").mockResolvedValue({
      content: [
        {
          type: "text",
          text: '[{"id":"item-a","score":3},{"id":"item-b","score":9},{"id":"item-c","score":6}]',
        },
      ],
    } as Awaited<ReturnType<typeof piAi.complete>>);
    try {
      const items = [
        makeRow({ id: "item-a" }),
        makeRow({ id: "item-b" }),
        makeRow({ id: "item-c" }),
      ];
      const result = await runPipeline(items, [{ type: "llm-rank", interests: ["tech"] }], {
        llmModel: fakeModel,
      });
      // Should be sorted highest-score first
      expect(result.map((r) => r.id)).toEqual(["item-b", "item-c", "item-a"]);
      expect(result.find((r) => r.id === "item-b")?.score).toBe(9);
      expect(result.find((r) => r.id === "item-c")?.score).toBe(6);
      expect(result.find((r) => r.id === "item-a")?.score).toBe(3);
    } finally {
      completeSpy.mockRestore();
    }
  });

  test("llm-rank with null model leaves scores null and order unchanged", async () => {
    const items = [makeRow({ id: "x" }), makeRow({ id: "y" })];
    const result = await runPipeline(items, [{ type: "llm-rank", interests: ["tech"] }], {
      llmModel: null,
    });
    expect(result.map((r) => r.id)).toEqual(["x", "y"]);
    expect(result.every((r) => r.score === null)).toBe(true);
  });

  // ── 4. Interests fallback ────────────────────────────────────────────────

  test("llm-rank falls back to ctx.llmConfig.interests when transform has no interests", async () => {
    let capturedPrompt = "";
    const completeSpy = spyOn(piAi, "complete").mockImplementation(async (_model, ctx) => {
      capturedPrompt = ctx.systemPrompt ?? "";
      return {
        content: [{ type: "text", text: '[{"id":"item-a","score":5}]' }],
      } as Awaited<ReturnType<typeof piAi.complete>>;
    });
    try {
      const items = [makeRow({ id: "item-a" })];
      await runPipeline(items, [{ type: "llm-rank" }], {
        llmModel: fakeModel,
        llmConfig: {
          provider: "openai",
          model: "gpt-4o",
          api_key: "test",
          interests: ["distributed systems", "security"],
        },
      });
      expect(capturedPrompt).toContain("distributed systems");
      expect(capturedPrompt).toContain("security");
    } finally {
      completeSpy.mockRestore();
    }
  });

  test("llm-rank transform interests override ctx.llmConfig.interests", async () => {
    let capturedPrompt = "";
    const completeSpy = spyOn(piAi, "complete").mockImplementation(async (_model, ctx) => {
      capturedPrompt = ctx.systemPrompt ?? "";
      return {
        content: [{ type: "text", text: '[{"id":"item-a","score":5}]' }],
      } as Awaited<ReturnType<typeof piAi.complete>>;
    });
    try {
      const items = [makeRow({ id: "item-a" })];
      await runPipeline(
        items,
        [{ type: "llm-rank", interests: ["rust", "wasm"] }],
        {
          llmModel: fakeModel,
          llmConfig: {
            provider: "openai",
            model: "gpt-4o",
            api_key: "test",
            interests: ["distributed systems"],
          },
        },
      );
      expect(capturedPrompt).toContain("rust");
      expect(capturedPrompt).toContain("wasm");
      expect(capturedPrompt).not.toContain("distributed systems");
    } finally {
      completeSpy.mockRestore();
    }
  });
});

// ── 5. Cross-source pipeline dedupe merges origins ──────────────────────────

describe("pipeline cross-source dedupe", () => {
  installTempDbHooks({ prefix: "pace-pipeline-", init: true, warnOnRmFail: true });

  test("dedupe step merges origins across items from two different sources", async () => {
    // Simulate two panels contributing items with the same URL
    const itemFromHn = makeRow({
      id: "hn-1",
      url: "https://example.com/article",
      source: "hackernews",
      origins: '["hackernews"]',
      title: "Article title",
    });
    const itemFromLobsters = makeRow({
      id: "lob-1",
      url: "https://example.com/article",
      source: "lobsters",
      origins: '["lobsters"]',
      title: "Article title",
    });

    // Gather both (as pipeline would) and run dedupe
    const combined = [itemFromHn, itemFromLobsters];
    const result = await runPipeline(
      combined,
      [{ type: "dedupe", strategy: "url" }],
      { llmModel: null },
    );

    // Should dedupe to one item with merged origins
    expect(result.length).toBe(1);
    const origins = JSON.parse(result[0].origins ?? "[]") as string[];
    expect(origins).toContain("hackernews");
    expect(origins).toContain("lobsters");
  });

  test("dedupe step merges origins from three sources into winner", async () => {
    const mkItem = (id: string, source: string) =>
      makeRow({
        id,
        url: "https://example.com/shared",
        source,
        origins: JSON.stringify([source]),
        title: "Same article",
      });

    const combined = [mkItem("hn-2", "hackernews"), mkItem("lob-2", "lobsters"), mkItem("rss-2", "rss")];
    const result = await runPipeline(
      combined,
      [{ type: "dedupe", strategy: "url" }],
      { llmModel: null },
    );

    expect(result.length).toBe(1);
    const origins = JSON.parse(result[0].origins ?? "[]") as string[];
    expect(origins.sort()).toEqual(["hackernews", "lobsters", "rss"]);
  });

  test("items with different URLs are not merged", async () => {
    const a = makeRow({ id: "a-uniq", url: "https://example.com/one", origins: '["hn"]' });
    const b = makeRow({ id: "b-uniq", url: "https://example.com/two", origins: '["lobsters"]' });
    const result = await runPipeline(
      [a, b],
      [{ type: "dedupe", strategy: "url" }],
      { llmModel: null },
    );
    expect(result.length).toBe(2);
  });
});
