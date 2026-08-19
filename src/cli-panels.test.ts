import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectPanelsList,
  formatPanelsJson,
  formatPanelsList,
  formatPanelsSummary,
  formatPanelsUsage,
} from "./cli-panels";
import { runCli } from "./test/cli-runner";
import { countDedupedItemsByPanel, saveItems } from "./db";
import { makeContentItem } from "./test/content-items";
import { installTempDbHooks } from "./test/temp-db";
import type { AppConfig } from "./config/types";

installTempDbHooks({ prefix: "pace-cli-panels-db-" });

function panelsConfig(): AppConfig {
  return {
    adapters: [
      { name: "hn", type: "hackernews" },
      { name: "tech", type: "rss", params: { urls: ["https://a.com/rss"] } },
    ],
    pipelines: [{ name: "ranked", input: "hn", transforms: [] }],
    layout: {
      direction: "row",
      children: [
        { panel: "Hacker News", id: "hn-panel", source: "hn" },
        { panel: "Everything", source: "all" },
      ],
    },
  } as unknown as AppConfig;
}

describe("formatPanelsUsage", () => {
  test("documents the list subcommand and what panel ids resolve", () => {
    const usage = formatPanelsUsage();
    expect(usage).toContain("pace panels <subcommand>");
    expect(usage).toContain("list");
    expect(usage).toContain("panel:");
    expect(usage).toContain("/api/panels/<id>.rss");
    expect(usage).toContain("items column counts the panel's stored deduped stories");
  });
});

describe("collectPanelsList", () => {
  test("collects panels in layout order with resolved ids and source names", () => {
    const rows = collectPanelsList(panelsConfig());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "hn-panel",
      name: "Hacker News",
      items: 0,
      sources: ["hn"],
      isAll: false,
    });
    expect(rows[1].name).toBe("Everything");
    expect(rows[1].isAll).toBe(true);
    // source: all resolves to every adapter and pipeline name.
    expect(rows[1].sources).toEqual(["hn", "tech", "ranked"]);
  });

  test("maps stored item counts onto panels by id, 0 when absent", () => {
    const counts = new Map([["hn-panel", 7]]);
    const rows = collectPanelsList(panelsConfig(), counts);
    expect(rows[0].items).toBe(7);
    expect(rows[1].items).toBe(0);
  });

  test("counts stored deduped items per panel through the real database", () => {
    saveItems("hn-panel", [
      makeContentItem({ id: "a1", title: "One", url: "https://ex.com/one" }),
      // Same story url twice — the dedup window collapses it to one count.
      makeContentItem({ id: "a2", title: "One again", url: "https://ex.com/one/" }),
      makeContentItem({ id: "a3", title: "Two", url: "https://ex.com/two" }),
    ]);
    const rows = collectPanelsList(panelsConfig(), countDedupedItemsByPanel());
    expect(rows[0].items).toBe(2);
    expect(rows[1].items).toBe(0);
  });

  test("throws a panels:-prefixed error when the layout has no panels", () => {
    const config = {
      adapters: [],
      layout: { direction: "row", children: [] },
    } as unknown as AppConfig;
    expect(() => collectPanelsList(config)).toThrow("panels: config has no panels in its layout");
  });
});

describe("formatPanelsList", () => {
  test("renders aligned id, name, items, and source columns", () => {
    const counts = new Map([["hn-panel", 12]]);
    const output = formatPanelsList(collectPanelsList(panelsConfig(), counts));
    const lines = output.split("\n");
    expect(lines[0]).toMatch(/^hn-panel {2,}Hacker News {2}12 {2}hn$/);
    // The count column right-aligns: 0 pads to the width of 12.
    expect(lines[1]).toMatch(/Everything {2,} 0 {2}\(all sources\) hn, tech, ranked$/);
    // Columns align: both names start at the same offset.
    expect(lines[0].indexOf("Hacker News")).toBe(lines[1].indexOf("Everything"));
  });
});

describe("formatPanelsJson", () => {
  test("emits {count, panels} with isAll exposed as all", () => {
    const doc = JSON.parse(formatPanelsJson(collectPanelsList(panelsConfig())));
    expect(doc.count).toBe(2);
    expect(doc.panels).toHaveLength(2);
    expect(doc.panels[0]).toEqual({
      id: "hn-panel",
      name: "Hacker News",
      items: 0,
      sources: ["hn"],
      all: false,
    });
    expect(doc.panels[1].all).toBe(true);
    // Internal naming quirk never leaks into the JSON shape.
    expect(doc.panels[0]).not.toHaveProperty("isAll");
  });
});

describe("formatPanelsSummary", () => {
  test("counts panels and stored items with singular/plural forms", () => {
    const rows = collectPanelsList(panelsConfig(), new Map([["hn-panel", 1]]));
    expect(formatPanelsSummary(rows)).toBe("panels: 2 panels, 1 stored item");
    expect(formatPanelsSummary(rows.slice(0, 1))).toBe("panels: 1 panel, 1 stored item");
    expect(formatPanelsSummary(collectPanelsList(panelsConfig()))).toBe(
      "panels: 2 panels, 0 stored items",
    );
  });
});

describe("pace panels (CLI)", () => {
  function writeConfig(dir: string): string {
    const path = join(dir, "config.yaml");
    writeFileSync(
      path,
      [
        "adapters:",
        "  - name: hn",
        "    type: hackernews",
        "layout:",
        "  direction: row",
        "  children:",
        "    - panel: Hacker News",
        "      id: hn-panel",
        "      source: hn",
      ].join("\n") + "\n",
    );
    return path;
  }

  test("panels list prints ids on stdout and a summary on stderr", () => {
    const dir = mkdtempSync(join(tmpdir(), "pace-cli-panels-"));
    try {
      const result = runCli(["panels", "list", "--config", writeConfig(dir)]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("hn-panel");
      expect(result.stdout).toContain("Hacker News");
      expect(result.stderr).toContain("panels: 1 panel");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("panels list --json prints a parseable JSON document on stdout", () => {
    const dir = mkdtempSync(join(tmpdir(), "pace-cli-panels-"));
    try {
      const result = runCli(["panels", "list", "--json", "--config", writeConfig(dir)]);
      expect(result.status).toBe(0);
      const doc = JSON.parse(result.stdout);
      expect(doc.count).toBe(1);
      // runCli shares a fixed test db, so only the shape of `items` is
      // asserted here — exact counting is covered by the db-backed test above.
      const { items, ...rest } = doc.panels[0];
      expect(typeof items).toBe("number");
      expect(rest).toEqual({
        id: "hn-panel",
        name: "Hacker News",
        sources: ["hn"],
        all: false,
      });
      // The summary stays on stderr so stdout pipes into jq cleanly.
      expect(result.stderr).toContain("panels: 1 panel");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unknown subcommand fails with usage", () => {
    const result = runCli(["panels", "nope"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown subcommand: nope");
  });

  test("serve-only options are rejected", () => {
    const result = runCli(["panels", "list", "--port", "1234"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown option(s) for this command: --port");
  });
});
