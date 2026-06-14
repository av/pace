import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderDashboard, type PanelData } from "./layout";
import { collectPanels, resolvePanelId } from "./layout/types";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import { expectDashboardRefreshAction } from "./test/server-harness";
import { loadConfig, isPanel } from "./config";

/**
 * Integration tests for counter display mode interactions with existing panel features.
 * Covers: refresh button, multi-source panels, non-counter items in counter panels,
 * counter items in regular panels, and display mode validation.
 */

// -- Section 1: Counter panel refresh button --

describe("counter panel refresh button", () => {
  test("counter panel renders a refresh button with correct form action", () => {
    const node = panelCfg("Stars", "counter", { display: "counter" });
    const counterItem = makeItem({
      title: "GitHub Stars",
      body: JSON.stringify({ value: 5000, unit: "stars" }),
    });
    const panelData = new Map<string, PanelData>([
      ["Stars", { items: [counterItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Refresh button is present
    expect(html).toContain('class="refresh-btn"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('<form method="POST"');
  });

  test("counter panel refresh action uses resolvePanelId-derived URL", () => {
    const node = panelCfg("Stars", "counter", { display: "counter" });
    const expectedPanelId = resolvePanelId(node);
    const panelData = new Map<string, PanelData>([
      ["Stars", { items: [] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expectDashboardRefreshAction(html, expectedPanelId);
  });

  test("counter panel refresh action uses explicit panel id when set", () => {
    const node = panelCfg("Stars", "counter", { display: "counter", id: "stars-panel" });
    const panelData = new Map<string, PanelData>([
      ["Stars", { items: [] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expectDashboardRefreshAction(html, "stars-panel");
  });

  test("counter panel refresh action prefers runtime panelId from panelData over layout-derived", () => {
    const node = panelCfg("Stars", "counter", { display: "counter", id: "layout-id" });
    const panelData = new Map<string, PanelData>([
      ["Stars", {
        panelId: "runtime-id",
        items: [],
        lastRefreshedAt: null,
      }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expectDashboardRefreshAction(html, "runtime-id");
    expect(html).not.toContain('action="/refresh/layout-id"');
  });

  test("counter panel shows lastRefreshedAt in header when available", () => {
    const node = panelCfg("Stars", "counter", { display: "counter" });
    const now = Date.now();
    const refreshed = new Date(now - 2 * 60000).toISOString(); // 2m ago
    const panelData = new Map<string, PanelData>([
      ["Stars", {
        panelId: "p1",
        items: [],
        lastRefreshedAt: refreshed,
      }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain("2m ago");
    expect(html).toContain('class="panel-refreshed"');
  });
});

// -- Section 2: Counter with multi-source panels --

describe("counter panel with multi-source", () => {
  test("counter panel with array source renders stat cards from all sources", () => {
    const node = panelCfg("Metrics", ["counter-stars", "counter-issues"], { display: "counter" });
    const items = [
      makeItem({ id: "s1", title: "Stars", body: JSON.stringify({ value: 93200, unit: "stars" }) }),
      makeItem({ id: "s2", title: "Issues", body: JSON.stringify({ value: 150, unit: "open" }) }),
    ];
    const panelData = new Map<string, PanelData>([
      ["Metrics", { items }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain("counter-panel");
    // Both stat cards rendered
    const cardCount = html.match(/stat-card/g);
    expect(cardCount?.length).toBe(2);
    expect(html).toContain("Stars");
    expect(html).toContain("Issues");
    expect(html).toContain("93.2k"); // abbreviated
    expect(html).toContain("150");
  });

  test("counter panel with multi-source where one source has no data still shows other stats", () => {
    // Simulates one adapter returned data, other returned nothing
    // Both items come through panelData keyed by panel name
    const items = [
      makeItem({ id: "s1", title: "Stars", body: JSON.stringify({ value: 5000 }) }),
    ];
    const node = panelCfg("Mixed", ["counter-stars", "counter-errors"], { display: "counter" });
    const panelData = new Map<string, PanelData>([
      ["Mixed", { items }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // One stat card rendered, no empty state because there IS data
    expect(html).toContain("stat-card");
    expect(html).toContain("Stars");
    expect(html).not.toContain("No data yet");
  });

  test("counter panel with multi-source where all sources have no data shows empty state", () => {
    const node = panelCfg("Empty Multi", ["counter-a", "counter-b"], { display: "counter" });
    const panelData = new Map<string, PanelData>([
      ["Empty Multi", { items: [] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain("No data yet");
    expect(html).not.toContain("stat-card");
  });

  test("counter panel with source config objects renders correctly", () => {
    const node = panelCfg("API Metrics", [
      { adapter: "counter-uptime", params: {} },
      { adapter: "counter-latency", params: {} },
    ], { display: "counter" });
    const items = [
      makeItem({ id: "u1", title: "Uptime", body: JSON.stringify({ value: 99.9, unit: "%" }) }),
      makeItem({ id: "l1", title: "P99 Latency", body: JSON.stringify({ value: 42, unit: "ms" }) }),
    ];
    const panelData = new Map<string, PanelData>([
      ["API Metrics", { items }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain("Uptime");
    expect(html).toContain("99.9");
    expect(html).toContain("P99 Latency");
    expect(html).toContain("42");
  });
});

// -- Section 3: Counter panel with non-counter items --

describe("counter panel with non-counter items", () => {
  test("counter panel receiving RSS-style items (plain text body) shows empty state", () => {
    // RSS items have plain text body, not JSON with { value: ... }
    const rssItem = makeItem({
      title: "New Post: How to Build APIs",
      body: "This is a blog post about building REST APIs.",
      source: "rss",
    });
    const node = panelCfg("Counters", "some-source", { display: "counter" });
    const panelData = new Map<string, PanelData>([
      ["Counters", { items: [rssItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // parseCounterBody returns null for non-JSON body, so no stat cards
    expect(html).toContain("No data yet");
    expect(html).not.toContain("stat-card");
    // Does NOT crash
    expect(html).toContain("counter-panel");
  });

  test("counter panel receiving items with null body shows empty state", () => {
    const nullBodyItem = makeItem({ title: "No Body", body: null });
    const node = panelCfg("Counters", "src", { display: "counter" });
    const panelData = new Map<string, PanelData>([
      ["Counters", { items: [nullBodyItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain("No data yet");
    expect(html).not.toContain("stat-card");
  });

  test("counter panel receiving JSON body without 'value' key shows empty state", () => {
    // JSON body that parses fine but lacks the { value: ... } shape
    const noValueItem = makeItem({
      title: "Wrong Shape",
      body: JSON.stringify({ count: 42, label: "hits" }),
    });
    const node = panelCfg("Counters", "src", { display: "counter" });
    const panelData = new Map<string, PanelData>([
      ["Counters", { items: [noValueItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain("No data yet");
    expect(html).not.toContain("stat-card");
  });

  test("counter panel with mix of valid counter items and invalid items only shows valid ones", () => {
    const validItem = makeItem({
      id: "v1",
      title: "Stars",
      body: JSON.stringify({ value: 1000, unit: "stars" }),
    });
    const invalidItem = makeItem({
      id: "i1",
      title: "Blog Post",
      body: "Just a plain text blog post body.",
    });
    const node = panelCfg("Mixed", "src", { display: "counter" });
    const panelData = new Map<string, PanelData>([
      ["Mixed", { items: [validItem, invalidItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Only the valid counter item renders as a stat card
    const cardCount = html.match(/stat-card/g);
    expect(cardCount?.length).toBe(1);
    expect(html).toContain("Stars");
    expect(html).toContain("1000");
    expect(html).not.toContain("No data yet");
    // The invalid item's title does NOT appear as a stat label
    expect(html).not.toContain("Blog Post");
  });

  test("counter panel receiving array body (valid JSON but not object) shows empty state", () => {
    const arrayItem = makeItem({
      title: "Array Data",
      body: JSON.stringify([1, 2, 3]),
    });
    const node = panelCfg("Counters", "src", { display: "counter" });
    const panelData = new Map<string, PanelData>([
      ["Counters", { items: [arrayItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // parseCounterBody: Array.isArray check, typeof "object", but "value" not in array
    expect(html).toContain("No data yet");
    expect(html).not.toContain("stat-card");
  });
});

// -- Section 4: Regular panel with counter items --

describe("regular panel with counter items", () => {
  test("counter items in a regular panel render as normal content cards", () => {
    const counterItem = makeItem({
      title: "GitHub Stars",
      url: "https://api.github.com/repos/test/repo",
      source: "counter",
      body: JSON.stringify({ value: 5000, unit: "stars", previous: 4500 }),
    });
    const node = panelCfg("Feed", "counter"); // no display: counter
    const panelData = new Map<string, PanelData>([
      ["Feed", { items: [counterItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Renders as normal ContentItemCard, not StatCard
    expect(html).not.toContain("stat-card");
    expect(html).not.toContain("counter-panel");
    expect(html).toContain("panel-body");
    expect(html).toContain("GitHub Stars");
    expect(html).toContain('class="item"');
    // Source pill shows "counter" with proper color class
    expect(html).toContain('class="item-source src-counter">counter</span>');
  });

  test("counter items in regular panel show their URL as a clickable link", () => {
    const counterItem = makeItem({
      title: "API Metric",
      url: "https://api.example.com/metrics",
      source: "counter",
      body: JSON.stringify({ value: 42 }),
    });
    const node = panelCfg("All Data", "counter");
    const panelData = new Map<string, PanelData>([
      ["All Data", { items: [counterItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain('href="https://api.example.com/metrics"');
    expect(html).toContain(">API Metric</a>");
  });

  test("regular panel does not use counter-panel CSS class or stat-card elements", () => {
    const counterItem = makeItem({
      title: "Downloads",
      body: JSON.stringify({ value: 1500000, unit: "downloads" }),
    });
    const node = panelCfg("Downloads", "counter");
    const panelData = new Map<string, PanelData>([
      ["Downloads", { items: [counterItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).not.toContain("counter-panel");
    expect(html).not.toContain("stat-card");
    expect(html).not.toContain("stat-value");
    expect(html).not.toContain("stat-unit");
    expect(html).toContain("panel-body");
  });

  test("source:all panel with counter items renders them as regular cards", () => {
    const counterItem = makeItem({
      title: "Active Users",
      source: "counter",
      body: JSON.stringify({ value: 200 }),
    });
    const rssItem = makeItem({
      id: "rss1",
      title: "Blog Post",
      source: "rss",
    });
    const node = panelCfg("Everything", "all");
    const panelData = new Map<string, PanelData>([
      ["Everything", { items: [counterItem, rssItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Both render as regular content item cards
    expect(html).toContain("Active Users");
    expect(html).toContain("Blog Post");
    expect(html).not.toContain("counter-panel");
    expect(html).not.toContain("stat-card");
    expect(html).toContain("panel-body");
  });
});

// -- Section 5: Counter display mode validation --

describe("counter display mode config validation", () => {
  let tmpDir: string;
  let cfgPath: string;
  let origPaceConfig: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-counter-integ-"));
    cfgPath = path.join(tmpDir, "pace.yaml");
    origPaceConfig = process.env.PACE_CONFIG;
  });

  afterEach(() => {
    if (origPaceConfig !== undefined) {
      process.env.PACE_CONFIG = origPaceConfig;
    } else {
      delete process.env.PACE_CONFIG;
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function setConfig(yamlContent: string) {
    fs.writeFileSync(cfgPath, yamlContent, "utf-8");
    process.env.PACE_CONFIG = cfgPath;
  }

  test("display: counter is valid on a panel with counter adapter source", () => {
    setConfig(`
adapters:
  - type: counter
    params:
      url: https://api.example.com/stats
      json_path: data.count
layout:
  direction: row
  children:
    - panel: Stats
      source: counter
      display: counter
`);
    const cfg = loadConfig();
    const panels = collectPanels(cfg.layout);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.display).toBe("counter");
  });

  test("display: counter is valid on a panel with non-counter adapter source", () => {
    // The display mode is a rendering hint, not tied to adapter type
    setConfig(`
adapters:
  - type: rss
    params:
      urls:
        - https://example.com/feed.xml
layout:
  direction: row
  children:
    - panel: RSS as Counter
      source: rss
      display: counter
`);
    // Should not throw - display: counter is valid on any panel
    const cfg = loadConfig();
    const panels = collectPanels(cfg.layout);
    expect(panels[0]!.display).toBe("counter");
  });

  test("display on a container is rejected as unknown key", () => {
    setConfig(`
layout:
  direction: row
  display: counter
  children:
    - panel: Feed
      source: all
`);
    expect(() => loadConfig()).toThrow(/display is not a valid layout container field/);
  });

  test("display: invalid-value is rejected as bad enum", () => {
    setConfig(`
adapters:
  - type: counter
    params:
      url: https://api.example.com/stats
      json_path: data.count
layout:
  direction: row
  children:
    - panel: Stats
      source: counter
      display: table
`);
    expect(() => loadConfig()).toThrow(/display must be one of: counter/);
  });

  test("display: empty string is rejected", () => {
    setConfig(`
adapters:
  - type: counter
    params:
      url: https://api.example.com/stats
      json_path: data.count
layout:
  direction: row
  children:
    - panel: Stats
      source: counter
      display: ""
`);
    expect(() => loadConfig()).toThrow(/display must be one of: counter/);
  });

  test("omitting display on a panel defaults to standard rendering", () => {
    setConfig(`
adapters:
  - type: counter
    params:
      url: https://api.example.com/stats
      json_path: data.count
layout:
  direction: row
  children:
    - panel: Stats
      source: counter
`);
    const cfg = loadConfig();
    const panels = collectPanels(cfg.layout);
    expect(panels[0]!.display).toBeUndefined();
  });

  test("display on image widget is rejected as unknown key", () => {
    setConfig(`
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      display: counter
`);
    expect(() => loadConfig()).toThrow(/display is not a valid image widget field/);
  });

  test("display on text widget is rejected as unknown key", () => {
    setConfig(`
layout:
  direction: row
  children:
    - text: Hello world
      display: counter
`);
    expect(() => loadConfig()).toThrow(/display is not a valid text widget field/);
  });

  test("display on iframe widget is rejected as unknown key", () => {
    setConfig(`
layout:
  direction: row
  children:
    - iframe: https://example.com
      display: counter
`);
    expect(() => loadConfig()).toThrow(/display is not a valid iframe widget field/);
  });
});

// -- Section 6: Side-by-side counter vs regular panel rendering --

describe("counter vs regular panel rendering symmetry", () => {
  const counterBody = JSON.stringify({ value: 42, unit: "req/s", previous: 30 });
  const counterItem = makeItem({
    id: "c1",
    title: "Requests",
    source: "counter",
    body: counterBody,
  });

  test("same data rendered as counter panel has stat-card, no item class", () => {
    const node = panelCfg("Counter View", "counter", { display: "counter" });
    const panelData = new Map<string, PanelData>([
      ["Counter View", { items: [counterItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain("stat-card");
    expect(html).toContain("counter-panel");
    expect(html).toContain("42");
    expect(html).toContain("req/s");
    expect(html).toContain("stat-trend-up"); // 42 > 30
    expect(html).not.toContain('class="item"');
    expect(html).not.toContain("panel-body");
  });

  test("same data rendered as regular panel has item class, no stat-card", () => {
    const node = panelCfg("Regular View", "counter"); // no display
    const panelData = new Map<string, PanelData>([
      ["Regular View", { items: [counterItem] }],
    ]);
    const layout = flexCfg("row", [node]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html).toContain('class="item"');
    expect(html).toContain("panel-body");
    expect(html).toContain("Requests");
    expect(html).not.toContain("stat-card");
    expect(html).not.toContain("counter-panel");
    expect(html).not.toContain("stat-trend");
  });

  test("both panels can coexist in the same layout", () => {
    const counterNode = panelCfg("Counter View", "counter", { display: "counter" });
    const regularNode = panelCfg("List View", "counter");
    const layout = flexCfg("row", [counterNode, regularNode]);
    const panelData = new Map<string, PanelData>([
      ["Counter View", { items: [counterItem] }],
      ["List View", { items: [counterItem] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Both panel types rendered
    expect(html).toContain("counter-panel");
    expect(html).toContain("panel-body");
    expect(html).toContain("stat-card");
    expect(html).toContain('class="item"');
    // Both have headers with the panel name
    expect(html).toContain("<h2>Counter View</h2>");
    expect(html).toContain("<h2>List View</h2>");
  });
});
