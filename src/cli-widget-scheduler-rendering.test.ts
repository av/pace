import { describe, test, expect, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { runCli } from "./test/cli-runner";
import { renderDashboard, type PanelData } from "./layout";
import { flexCfg, panelCfg, textCfg } from "./test/layout-cfg";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { createSchedulerState } from "./scheduler-state";
import { createSchedulerRuntime } from "./scheduler-runtime";
import { collectPanels, buildLayoutRuntimeMaps, type AppConfig, type LayoutNodeConfig } from "./config/types";
import { installTempDbHooks } from "./test/temp-db";
import { makeMockAdapter, adaptersMap } from "./test/adapter-mocks";
import { makeContentItem } from "./test/content-items";
import * as dbMod from "./db";
import { formatAdapterExplain, checkConfig } from "./cli-help";

// =============================================================================
// 1. CLI with widget configs
// =============================================================================

describe("CLI: adapters explain bookmarks", () => {
  test("exit 0 and shows adapter type header", () => {
    const result = runCli(["adapters", "explain", "bookmarks"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("adapter: bookmarks");
  });

  test("shows summary line", () => {
    const result = runCli(["adapters", "explain", "bookmarks"]);
    expect(result.stdout).toContain("summary:");
    expect(result.stdout).toContain("curated bookmark links");
  });

  test("shows items param as required", () => {
    const result = runCli(["adapters", "explain", "bookmarks"]);
    expect(result.stdout).toContain("items");
    expect(result.stdout).toContain("required");
    expect(result.stdout).toContain("object[]");
  });

  test("shows example YAML with type: bookmarks", () => {
    const result = runCli(["adapters", "explain", "bookmarks"]);
    expect(result.stdout).toContain("example:");
    expect(result.stdout).toContain("type: bookmarks");
  });

  test("shows common adapter footer", () => {
    const result = runCli(["adapters", "explain", "bookmarks"]);
    expect(result.stdout).toContain("common to all adapters");
    expect(result.stdout).toContain("refresh_interval");
    expect(result.stdout).toContain("clamped at runtime");
  });
});

describe("CLI: adapters explain counter", () => {
  test("exit 0 and shows adapter type header", () => {
    const result = runCli(["adapters", "explain", "counter"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("adapter: counter");
  });

  test("shows url and json_path as required", () => {
    const result = runCli(["adapters", "explain", "counter"]);
    // The params section after the example block starts with "\nparams:\n"
    const lastParamsIdx = result.stdout.lastIndexOf("\nparams:\n");
    expect(lastParamsIdx).toBeGreaterThan(-1);
    const paramsSection = result.stdout.slice(lastParamsIdx).split("\ncommon")[0];
    // url and json_path param lines should include "required"
    expect(paramsSection).toContain("url  string  required");
    expect(paramsSection).toContain("json_path  string  required");
  });

  test("shows optional params (label, unit, compare_url, headers)", () => {
    const result = runCli(["adapters", "explain", "counter"]);
    expect(result.stdout).toContain("label");
    expect(result.stdout).toContain("unit");
    expect(result.stdout).toContain("compare_url");
    expect(result.stdout).toContain("compare_path");
    expect(result.stdout).toContain("headers");
  });

  test("shows example YAML with type: counter", () => {
    const result = runCli(["adapters", "explain", "counter"]);
    expect(result.stdout).toContain("example:");
    expect(result.stdout).toContain("type: counter");
    expect(result.stdout).toContain("json_path:");
  });

  test("counter has 7 documented params", () => {
    const output = formatAdapterExplain("counter");
    // The real params section is the last "params:" block (after the example)
    const lastParamsIdx = output.lastIndexOf("\nparams:\n");
    const paramsSection = output.slice(lastParamsIdx + "\nparams:\n".length).split("\ncommon")[0];
    const paramLines = paramsSection.split("\n").filter((l) => l.startsWith("  ") && l.trim().length > 0);
    expect(paramLines.length).toBe(7);
  });
});

describe("CLI: config check with widget configs", () => {
  let tmpDir: string;

  function makeTmpConfig(content: string): string {
    const path = join(tmpDir, `cfg-${Date.now()}.yaml`);
    writeFileSync(path, content);
    return path;
  }

  test("config check validates a file with all widget types", () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-widget-"));
    try {
      const cfgPath = makeTmpConfig(`
adapters:
  - type: hackernews
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      alt: Logo
    - text: "Hello world"
      format: plain
    - iframe: https://grafana.example.com/d/1
    - panel: news
      source: hackernews
`);
      const result = runCli(["config", "check", cfgPath]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("config OK:");
      expect(result.stdout).toContain("1 adapters");
      expect(result.stdout).toContain("1 panels");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("config check passes for widget-only config (zero adapters)", () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-widget-"));
    try {
      const cfgPath = makeTmpConfig(`
adapters: []
layout:
  direction: column
  children:
    - image: https://example.com/banner.png
    - text: "Welcome to the dashboard"
    - iframe: https://grafana.example.com/d/overview
`);
      const result = runCli(["config", "check", cfgPath]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("0 adapters");
      expect(result.stdout).toContain("0 panels");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("config check reports error for widget with invalid discriminator combo", () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-widget-"));
    try {
      const cfgPath = makeTmpConfig(`
adapters: []
layout:
  direction: row
  children:
    - image: https://example.com/img.png
      text: "bad - two discriminators"
`);
      const result = runCli(["config", "check", cfgPath]);
      expect(result.status).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("config check warns but passes for iframe with unknown sandbox token (stripped at runtime)", () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-widget-"));
    try {
      const cfgPath = makeTmpConfig(`
adapters: []
layout:
  direction: row
  children:
    - iframe: https://example.com
      sandbox: "allow-evil-scripts"
`);
      const result = runCli(["config", "check", cfgPath]);
      // Validation warns but passes (unknown tokens stripped at render time, not rejected)
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("config OK:");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("config check rejects image widget with dangerous URL scheme", () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-widget-"));
    try {
      const cfgPath = makeTmpConfig(`
adapters: []
layout:
  direction: row
  children:
    - image: "javascript:alert(1)"
`);
      const result = runCli(["config", "check", cfgPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('disallowed scheme "javascript"');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("config check passes for bookmarks + counter config", () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-widget-"));
    try {
      const cfgPath = makeTmpConfig(`
adapters:
  - type: bookmarks
    name: links
    params:
      items:
        - title: GitHub
          url: https://github.com
  - type: counter
    name: stars
    params:
      url: https://api.github.com/repos/oven-sh/bun
      json_path: stargazers_count
layout:
  direction: row
  children:
    - panel: Links
      source: links
    - panel: Stars
      source: stars
      display: counter
`);
      const result = runCli(["config", "check", cfgPath]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("2 adapters");
      expect(result.stdout).toContain("2 panels");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("config check error for counter missing required json_path", () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-widget-"));
    try {
      const cfgPath = makeTmpConfig(`
adapters:
  - type: counter
    name: broken
    params:
      url: https://api.example.com/stats
layout:
  direction: row
  children:
    - panel: Stats
      source: broken
      display: counter
`);
      const result = runCli(["config", "check", cfgPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("config:");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("CLI: checkConfig unit function with widgets", () => {
  test("checkConfig counts only panels, not widgets, in panel count", () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "pace-chk-"));
    try {
      const cfgPath = join(tmpDir, "widgets.yaml");
      writeFileSync(cfgPath, `
adapters:
  - type: hackernews
layout:
  direction: column
  children:
    - image: https://example.com/logo.png
    - text: "Welcome"
    - iframe: https://embed.example.com
    - panel: feed
      source: hackernews
    - panel: feed2
      source: hackernews
`);
      const summary = checkConfig(cfgPath);
      expect(summary).toContain("1 adapters");
      // Only 2 panels counted, not the 3 widgets
      expect(summary).toContain("2 panels");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 2. Scheduler with mixed configs
// =============================================================================

describe("scheduler: timer leak prevention", () => {
  installTempDbHooks({ prefix: "pace-timer-leak-" });

  test("multiple startScheduler calls do not create duplicate prune timers", () => {
    const state = createSchedulerState();
    const runtime = createSchedulerRuntime(state);
    const config: AppConfig = {
      adapters: [] as any[],
      layout: flexCfg("row", []),
    };
    const adapters = new Map();
    const panelMap = { dashboardPanels: [], sourceToPanels: new Map(), sourceToReadKey: new Map() };

    const setIntervalSpy = spyOn(globalThis, "setInterval");
    const callsBefore = setIntervalSpy.mock.calls.length;

    try {
      runtime.startScheduler(config, adapters, panelMap, null);
      const callsAfterFirst = setIntervalSpy.mock.calls.length;
      // Prune timer should have been set
      expect(callsAfterFirst).toBeGreaterThan(callsBefore);
      expect(state.pruneTimer).not.toBeNull();

      // Second start should be a no-op (isStarted guard)
      runtime.startScheduler(config, adapters, panelMap, null);
      expect(setIntervalSpy.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      runtime.stopScheduler();
      setIntervalSpy.mockRestore();
    }
  });

  test("stopScheduler clears prune timer, allowing clean restart", () => {
    const state = createSchedulerState();
    const runtime = createSchedulerRuntime(state);
    const config: AppConfig = {
      adapters: [] as any[],
      layout: flexCfg("row", []),
    };
    const adapters = new Map();
    const panelMap = { dashboardPanels: [], sourceToPanels: new Map(), sourceToReadKey: new Map() };

    try {
      runtime.startScheduler(config, adapters, panelMap, null);
      expect(state.isStarted()).toBe(true);
      const firstTimer = state.pruneTimer;

      runtime.stopScheduler();
      expect(state.isStarted()).toBe(false);
      expect(state.pruneTimer).toBeNull();

      // Restart should create a new prune timer, not leak the old one
      runtime.startScheduler(config, adapters, panelMap, null);
      expect(state.isStarted()).toBe(true);
      expect(state.pruneTimer).not.toBeNull();
      expect(state.pruneTimer).not.toBe(firstTimer);
    } finally {
      runtime.stopScheduler();
    }
  });

  test("widget-only config (zero adapters) sets prune timer only", () => {
    const state = createSchedulerState();
    const runtime = createSchedulerRuntime(state);
    const config: AppConfig = {
      adapters: [] as any[],
      layout: flexCfg("column", [
        { image: "https://example.com/logo.png" },
        { text: "Hello" },
        { iframe: "https://grafana.example.com" },
      ]),
    };
    const adapters = new Map();
    const panelMap = { dashboardPanels: [], sourceToPanels: new Map(), sourceToReadKey: new Map() };

    try {
      runtime.startScheduler(config, adapters, panelMap, null);

      // Should be started (prune timer active)
      expect(state.isStarted()).toBe(true);
      expect(state.pruneTimer).not.toBeNull();

      // No adapter or pipeline entries
      expect(state.adapterEntries).toHaveLength(0);
      expect(state.pipelineEntries).toHaveLength(0);
    } finally {
      runtime.stopScheduler();
    }
  });

  test("config with widgets + adapters: scheduler runs adapters, widget nodes ignored", () => {
    const state = createSchedulerState();
    const runtime = createSchedulerRuntime(state);
    const config: AppConfig = {
      adapters: [{ type: "hackernews", refresh_interval: 15 }],
      layout: flexCfg("row", [
        { image: "https://example.com/logo.png" },
        { panel: "news", source: "hackernews", id: "news-panel" },
      ]),
    };
    const items = [makeContentItem({ id: "hn1", title: "Test", url: "https://hn.example.com", source: "hackernews" })];
    const adapters = adaptersMap(["hackernews", makeMockAdapter(items)]);
    const panelMap = {
      dashboardPanels: [{ panel: config.layout.children[1], pid: "news-panel", isAll: false }],
      sourceToPanels: new Map([["hackernews", ["news-panel"]]]),
      sourceToReadKey: new Map([["hackernews", "hackernews"]]),
    };

    try {
      runtime.startScheduler(config, adapters, panelMap, null);

      // Only hackernews adapter scheduled, no widget entries
      expect(state.adapterEntries).toHaveLength(1);
      expect(state.adapterEntries[0].name).toBe("hackernews");
      expect(state.pruneTimer).not.toBeNull();
    } finally {
      runtime.stopScheduler();
    }
  });
});

// =============================================================================
// 3. Rendering pipeline
// =============================================================================

describe("rendering: layout ordering", () => {
  test("widgets and panels render in layout order (left to right)", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/first.png", alt: "first" },
      panelCfg("Middle Panel", "rss"),
      { text: "Last text widget" },
    ]);
    const panelData = new Map<string, PanelData>([
      ["Middle Panel", { items: [makeItem({ title: "News Item" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Verify ordering: image appears before panel, panel before text
    const imageIdx = html.indexOf("first.png");
    const panelIdx = html.indexOf("Middle Panel");
    const textIdx = html.indexOf("Last text widget");

    expect(imageIdx).toBeGreaterThan(-1);
    expect(panelIdx).toBeGreaterThan(-1);
    expect(textIdx).toBeGreaterThan(-1);
    expect(imageIdx).toBeLessThan(panelIdx);
    expect(panelIdx).toBeLessThan(textIdx);
  });

  test("nested containers preserve child order", () => {
    const layout = flexCfg("column", [
      flexCfg("row", [
        { text: "Row1-Child1" },
        { text: "Row1-Child2" },
      ]),
      flexCfg("row", [
        { text: "Row2-Child1" },
        panelCfg("Row2-Panel", "rss"),
      ]),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Row2-Panel", { items: [] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    const positions = [
      html.indexOf("Row1-Child1"),
      html.indexOf("Row1-Child2"),
      html.indexOf("Row2-Child1"),
      html.indexOf("Row2-Panel"),
    ];
    // All should appear in order
    for (let i = 0; i < positions.length - 1; i++) {
      expect(positions[i]).toBeLessThan(positions[i + 1]);
    }
  });

});

describe("rendering: widgets have no refresh buttons", () => {
  test("image widget does not have refresh button", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/img.png", alt: "test" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("image-widget");
    expect(html).not.toContain("refresh-btn");
    expect(html).not.toContain('<form method="POST"');
  });

  test("text widget does not have refresh button", () => {
    const layout = flexCfg("row", [
      { text: "Some text", title: "Notes" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("text-widget");
    expect(html).not.toContain("refresh-btn");
    expect(html).not.toContain('<form method="POST"');
  });

  test("iframe widget does not have refresh button", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com", title: "Embed" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("iframe-panel");
    expect(html).not.toContain("refresh-btn");
    expect(html).not.toContain('<form method="POST"');
  });

  test("regular panel DOES have refresh button", () => {
    const layout = flexCfg("row", [
      panelCfg("Feed", "rss"),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Feed", { items: [makeItem({ title: "Item" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("refresh-btn");
    expect(html).toContain('<form method="POST"');
  });

  test("counter panel DOES have refresh button", () => {
    const counterItem = makeItem({
      title: "Stars",
      body: JSON.stringify({ value: 42, unit: "stars" }),
    });
    const layout = flexCfg("row", [
      panelCfg("Stats", "counter", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Stats", { items: [counterItem] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("refresh-btn");
    expect(html).toContain('<form method="POST"');
  });

});

describe("rendering: stylesheet includes widget CSS classes", () => {
  test("HTML output links to /styles.css", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/img.png" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain('<link rel="stylesheet" href="/styles.css"/>');
  });

  test("image widget uses image-widget CSS class", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/img.png" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain('class="image-widget"');
  });

  test("text widget uses text-widget and text-widget-body CSS classes", () => {
    const layout = flexCfg("row", [
      { text: "Hello world" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("text-widget");
    expect(html).toContain("text-widget-body");
  });

  test("iframe widget uses iframe-panel CSS class", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain('class="iframe-panel"');
  });

  test("counter panel uses counter-panel CSS class", () => {
    const counterItem = makeItem({
      title: "Metric",
      body: JSON.stringify({ value: 1 }),
    });
    const layout = flexCfg("row", [
      panelCfg("M", "c", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["M", { items: [counterItem] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="counter-panel"');
  });
});

describe("rendering: full dashboard with all widget types + bookmarks + counter", () => {
  test("complete dashboard with all node types renders valid HTML", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        { image: "https://example.com/logo.png", alt: "Logo", link: "https://example.com", max_height: "80px" },
        textCfg("# Dashboard\n- Item 1\n- Item 2", "markdown", { title: "Info" }),
        { iframe: "https://grafana.example.com/d/overview", title: "Grafana", height: "400px" },
      ]),
      flexCfg("column", [
        panelCfg("Bookmarks", "links"),
        panelCfg("Stats", "stars", { display: "counter" }),
        panelCfg("News", "rss"),
      ]),
    ]);

    const bookmarkItems = [
      makeItem({ id: "bm1", title: "GitHub", url: "https://github.com", source: "bookmarks" }),
      makeItem({ id: "bm2", title: "Docs", url: "https://docs.example.com", source: "bookmarks" }),
    ];
    const counterItems = [
      makeItem({ id: "c1", title: "Stars", body: JSON.stringify({ value: 93200, unit: "stars", previous: 90000 }) }),
      makeItem({ id: "c2", title: "Issues", body: JSON.stringify({ value: 1234, unit: "issues" }) }),
    ];
    const rssItems = [
      makeItem({ id: "r1", title: "Breaking News", url: "https://news.example.com/1" }),
    ];

    const panelData = new Map<string, PanelData>([
      ["Bookmarks", { items: bookmarkItems }],
      ["Stats", { items: counterItems }],
      ["News", { items: rssItems }],
    ]);

    const html = renderDashboard({ layout, panelData, updatedAt: "2026-06-14 15:00" });

    // HTML document structure
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>pace</title>");
    expect(html).toContain('<link rel="stylesheet" href="/styles.css"/>');

    // Image widget
    expect(html).toContain('src="https://example.com/logo.png"');
    expect(html).toContain('alt="Logo"');
    expect(html).toContain("max-height:80px");
    expect(html).toContain('href="https://example.com"');

    // Text widget (markdown)
    expect(html).toContain("<h2>Info</h2>");
    expect(html).toContain("<h1");
    expect(html).toContain("<li>Item 1</li>");

    // Iframe widget
    expect(html).toContain('src="https://grafana.example.com/d/overview"');
    expect(html).toContain("<h2>Grafana</h2>");
    expect(html).toContain("height:400px");
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain('referrerpolicy="no-referrer"');

    // Bookmarks panel (regular panel rendering)
    expect(html).toContain("GitHub");
    expect(html).toContain("Docs");

    // Counter panel
    expect(html).toContain("counter-panel");
    expect(html).toContain("93.2k");
    expect(html).toContain("stat-trend-up");
    // 1234 is below 10000 threshold so not abbreviated
    expect(html).toContain("1234");

    // RSS panel
    expect(html).toContain("Breaking News");

    // Footer
    expect(html).toContain("2026-06-14 15:00 UTC");

    // Verify ordering: image column before panels column
    const imagePos = html.indexOf("logo.png");
    const bookmarksPos = html.indexOf("Bookmarks");
    expect(imagePos).toBeLessThan(bookmarksPos);
  });

  test("widgets in layout do not produce panel data entries or DB queries", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/img.png" },
      { text: "Hello" },
      { iframe: "https://embed.example.com" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // All three widgets render without needing panelData
    expect(html).toContain("image-widget");
    expect(html).toContain("text-widget");
    expect(html).toContain("iframe-panel");
    // No empty-state or "No content yet" since widgets are self-contained
    expect(html).not.toContain("No content yet");
  });
});
