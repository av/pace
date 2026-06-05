import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDb, closeDb, getAllItemsByPanel, saveItems } from "./db";
import { startScheduler, stopScheduler, refreshSources } from "./scheduler";
import { isPanel } from "./config";
import type { AppConfig, PanelConfig } from "./config";
import { panelMap } from "./test/panel-map";

function domainConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    adapters: [],
    layout: { direction: "column", children: [{ panel: "out", source: "merge", limit: 50 }] },
    ...overrides,
  };
}

describe("domain", () => {
  let tempDir: string;
  let origEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pace-domain-test-"));
    origEnv = process.env.PACE_DB_PATH;
    process.env.PACE_DB_PATH = join(tempDir, "test.db");
    stopScheduler();
    closeDb();
    initDb();
  });

  afterEach(() => {
    stopScheduler();
    closeDb();
    if (origEnv !== undefined) {
      process.env.PACE_DB_PATH = origEnv;
    } else {
      delete process.env.PACE_DB_PATH;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("layout panel source all bypass", () => {
    const layout = {
      direction: "column",
      children: [
        { panel: "global", source: "all" },
        { panel: "tech", source: "hackernews" },
        { panel: "pipe", source: "my-pipe" },
      ],
    };
    expect(layout.children.some((c) => isPanel(c) && c.source === "all")).toBe(true);
    const allBypassSources = layout.children
      .filter((c): c is PanelConfig => isPanel(c) && c.source === "all")
      .map((c) => c.source);
    expect(allBypassSources).toEqual(["all"]);
  });

  it("pipeline refresh merges adapter feeds, dedupes by url (latest), persists prefixed rows", async () => {
    const tsOld = "2024-01-01T00:00:00.000Z";
    const tsNew = "2024-06-01T00:00:00.000Z";
    saveItems("feedA", [
      {
        id: "a1",
        title: "Dup story (old)",
        url: "https://news.example/dup",
        source: "feedA",
        timestamp: new Date(tsOld),
      },
    ]);
    saveItems("feedB", [
      {
        id: "b1",
        title: "Dup story (new)",
        url: "https://news.example/dup",
        source: "feedB",
        timestamp: new Date(tsNew),
      },
      {
        id: "b2",
        title: "Unique",
        url: "https://news.example/unique",
        source: "feedB",
        timestamp: new Date(tsNew),
      },
    ]);
    const config = domainConfig({
      pipelines: [
        {
          name: "merge",
          sources: ["feedA", "feedB"],
          transforms: [{ type: "dedupe", strategy: "url", keep: "latest" }],
        },
      ],
    });
    const pm = panelMap({ merge: ["outPanel"] }, { feedA: "feedA", feedB: "feedB" });
    startScheduler(config, new Map(), pm, null);
    await refreshSources(["merge"]);
    const out = getAllItemsByPanel("outPanel");
    expect(out.map((r) => r.id).sort()).toEqual(["pipeline:merge:b1", "pipeline:merge:b2"]);
    expect(out.find((r) => r.id === "pipeline:merge:b1")?.title).toBe("Dup story (new)");
  });
});