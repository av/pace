import { describe, it, expect } from "bun:test";
import { renderDashboard, type PanelData } from "./layout";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import type { ImageWidgetConfig, TextWidgetConfig, IframeWidgetConfig } from "./config/types";

/**
 * Verify that all expected CSS classes appear in rendered HTML output.
 * These tests ensure the stylesheet rules in styles.css have matching
 * DOM elements produced by the layout components.
 */

function renderWidget(
  node: Parameters<typeof flexCfg>[1][0],
  panelData?: Map<string, PanelData>,
): string {
  const layout = flexCfg("row", [node]);
  return renderDashboard({ layout, panelData: panelData ?? new Map(), updatedAt: "now" });
}

describe("CSS class presence in rendered HTML", () => {
  it("image widget renders .flex-panel and .image-widget classes", () => {
    const node: ImageWidgetConfig = { image: "https://example.com/pic.png", alt: "test" };
    const html = renderWidget(node);
    expect(html).toContain('class="flex-panel"');
    expect(html).toContain('class="image-widget"');
  });

  it("text widget renders .flex-panel, .panel, .text-widget, and .text-widget-body classes", () => {
    const node: TextWidgetConfig = { text: "Hello world", title: "Note" };
    const html = renderWidget(node);
    expect(html).toContain('class="flex-panel"');
    expect(html).toContain('class="panel text-widget"');
    expect(html).toContain('class="text-widget-body"');
    expect(html).toContain('class="panel-header"');
  });

  it("iframe widget renders .flex-panel and .iframe-panel classes", () => {
    const node: IframeWidgetConfig = { iframe: "https://example.com/embed" };
    const html = renderWidget(node);
    expect(html).toContain('class="flex-panel"');
    expect(html).toContain('class="iframe-panel"');
  });

  it("counter panel renders .flex-panel, .panel, .counter-panel, and .stat-card classes", () => {
    const counterItem = makeItem({
      title: "Stars",
      body: JSON.stringify({ value: 42000, unit: "stars" }),
      source: "counter",
    });
    const node = panelCfg("Metrics", "counter", { display: "counter" });
    const panelData = new Map<string, PanelData>([["Metrics", { items: [counterItem] }]]);
    const html = renderWidget(node, panelData);
    expect(html).toContain('class="flex-panel"');
    expect(html).toContain('class="panel"');
    expect(html).toContain('class="counter-panel"');
    expect(html).toContain('class="stat-card"');
    expect(html).toContain('class="stat-value"');
    expect(html).toContain('class="stat-label"');
    expect(html).toContain('class="stat-unit"');
  });

  it("regular panel renders .flex-panel, .panel, .panel-header, .panel-body, and .refresh-btn", () => {
    const item = makeItem({ title: "Test", source: "rss" });
    const node = panelCfg("Feed", "rss");
    const panelData = new Map<string, PanelData>([["Feed", { items: [item] }]]);
    const html = renderWidget(node, panelData);
    expect(html).toContain('class="flex-panel"');
    expect(html).toContain('class="panel"');
    expect(html).toContain('class="panel-header"');
    expect(html).toContain('class="panel-body"');
    expect(html).toContain('class="refresh-btn"');
    expect(html).toContain('class="panel-actions"');
  });

  it("source pill colors: bookmarks source gets src-bookmarks class", () => {
    const item = makeItem({ title: "Link", source: "bookmarks" });
    const node = panelCfg("Links", "bookmarks");
    const panelData = new Map<string, PanelData>([["Links", { items: [item] }]]);
    const html = renderWidget(node, panelData);
    expect(html).toContain("src-bookmarks");
    expect(html).toContain('class="item-source src-bookmarks"');
  });

  it("source pill colors: counter source gets src-counter class", () => {
    const item = makeItem({ title: "Metric", source: "counter" });
    const node = panelCfg("Stats", "counter");
    const panelData = new Map<string, PanelData>([["Stats", { items: [item] }]]);
    const html = renderWidget(node, panelData);
    expect(html).toContain("src-counter");
    expect(html).toContain('class="item-source src-counter"');
  });

  it("counter panel with trend renders .stat-trend-up or .stat-trend-down", () => {
    const upItem = makeItem({
      title: "Going Up",
      body: JSON.stringify({ value: 100, previous: 50 }),
      source: "counter",
    });
    const downItem = makeItem({
      title: "Going Down",
      body: JSON.stringify({ value: 30, previous: 80 }),
      source: "counter",
    });
    const node = panelCfg("Trends", "counter", { display: "counter" });
    const panelData = new Map<string, PanelData>([["Trends", { items: [upItem, downItem] }]]);
    const html = renderWidget(node, panelData);
    expect(html).toContain("stat-trend-up");
    expect(html).toContain("stat-trend-down");
  });

  it("flex-container class on container nodes with flex-root on the outer wrapper", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [{ image: "https://example.com/a.png" } as ImageWidgetConfig]),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain('class="flex-root"');
    expect(html).toContain('class="flex-container"');
  });

  it("empty counter panel renders .empty-state class", () => {
    const node = panelCfg("Empty", "counter", { display: "counter" });
    const panelData = new Map<string, PanelData>([["Empty", { items: [] }]]);
    const html = renderWidget(node, panelData);
    expect(html).toContain('class="empty-state"');
    expect(html).toContain("No data yet");
  });
});
