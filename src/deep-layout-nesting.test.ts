import { describe, it, expect } from "bun:test";
import { renderDashboard, type PanelData } from "./layout";
import { flexCfg, panelCfg, textCfg } from "./test/layout-cfg";
import { makeContentItemRow as makeItem } from "./test/content-items";
import type { LayoutNodeConfig } from "./config/types";

// ---------------------------------------------------------------------------
// 1. Deep nesting (5+ levels of nested containers with widgets)
// ---------------------------------------------------------------------------

describe("deep nesting: 5+ levels of containers with widgets", () => {
  it("5 levels deep: row > column > row > column > row with image at leaf", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        flexCfg("row", [
          flexCfg("column", [
            flexCfg("row", [
              { image: "https://example.com/deep.png", alt: "Deep" },
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain('src="https://example.com/deep.png"');
    expect(html).toContain('alt="Deep"');
    const containers = html.match(/class="flex-container"/g);
    expect(containers?.length).toBe(5);
  });

  it("multiple widgets at the same nesting level all render", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        flexCfg("row", [
          { image: "https://example.com/a.png", alt: "A" },
          { text: "Sibling text" },
          { iframe: "https://example.com/embed" },
          panelCfg("P", "rss"),
        ]),
      ]),
    ]);
    const panelData = new Map<string, PanelData>([
      ["P", { items: [] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('alt="A"');
    expect(html).toContain("Sibling text");
    expect(html).toContain('src="https://example.com/embed"');
    expect(html).toContain("<h2>P</h2>");
    // 3 widget flex-panels + 1 panel flex-panel = 4
    const flexPanels = html.match(/class="flex-panel"/g);
    expect(flexPanels?.length).toBe(4);
  });

  it("10-level nesting with panels and widgets renders without error", () => {
    // Build a 10-deep chain: each level is a container wrapping the next
    let inner: LayoutNodeConfig = { text: "Deepest leaf at level 10" };
    for (let i = 9; i >= 1; i--) {
      const dir = i % 2 === 0 ? "column" : "row";
      inner = flexCfg(dir as "row" | "column", [inner]);
    }
    const html = renderDashboard({ layout: inner, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("Deepest leaf at level 10");
    const containers = html.match(/class="flex-container"/g);
    expect(containers?.length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 2. Flex distribution
// ---------------------------------------------------------------------------

describe("flex distribution: proportional widgets", () => {
  it("widget with flex:0 renders flex:none (natural size, no grow)", () => {
    const layout = flexCfg("row", [
      { text: "Zero flex", flex: 0 },
      { text: "Normal flex" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:none;");
    expect(html).toContain("flex:1;");
    expect(html).toContain("Zero flex");
    expect(html).toContain("Normal flex");
  });
});


// ---------------------------------------------------------------------------
// 4. Layout rendering order
// ---------------------------------------------------------------------------

describe("layout rendering order: HTML preserves YAML source order", () => {
  it("children render in declaration order", () => {
    const layout = flexCfg("row", [
      { text: "FIRST_MARKER" },
      { text: "SECOND_MARKER" },
      { text: "THIRD_MARKER" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    const first = html.indexOf("FIRST_MARKER");
    const second = html.indexOf("SECOND_MARKER");
    const third = html.indexOf("THIRD_MARKER");
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
  });

  it("two identical text widgets in different positions both render (no dedup)", () => {
    const layout = flexCfg("row", [
      { text: "DUPLICATE_CONTENT" },
      { image: "https://example.com/separator.png" },
      { text: "DUPLICATE_CONTENT" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    const matches = html.match(/DUPLICATE_CONTENT/g);
    expect(matches?.length).toBe(2);
  });

  it("nested containers maintain parent-before-child order in HTML", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        { text: "NESTED_CHILD" },
      ]),
      { text: "SIBLING_AFTER" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    const childPos = html.indexOf("NESTED_CHILD");
    const siblingPos = html.indexOf("SIBLING_AFTER");
    expect(childPos).toBeLessThan(siblingPos);
  });

  it("container with 0 children renders as empty container div", () => {
    const layout = flexCfg("row", [
      flexCfg("column", []),
      { text: "After empty" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // The empty container should still render a flex-container div
    const containers = html.match(/class="flex-container"/g);
    expect(containers?.length).toBe(2);
    expect(html).toContain("After empty");
  });
});

// ---------------------------------------------------------------------------
// 5. Validation of complex layouts
// ---------------------------------------------------------------------------

describe("validation: complex layouts pass through correctly", () => {
  it("layout with 10+ widgets of all 3 types + panels + containers renders", () => {
    const layout = flexCfg("row", [
      // Column 1: image gallery
      flexCfg("column", [
        { image: "https://example.com/1.png", alt: "I1", flex: 1 },
        { image: "https://example.com/2.png", alt: "I2", flex: 1 },
        { image: "https://example.com/3.png", alt: "I3", flex: 1 },
        { image: "https://example.com/4.png", alt: "I4", flex: 1 },
      ], { flex: 1 }),
      // Column 2: text + iframe
      flexCfg("column", [
        textCfg("# Dashboard", "markdown", { title: "Header" }),
        { text: "Status: all systems operational" },
        { iframe: "https://grafana.example.com/d/1", title: "Grafana 1", flex: 2 },
        { iframe: "https://grafana.example.com/d/2", title: "Grafana 2", flex: 2 },
      ], { flex: 2 }),
      // Column 3: panels + more widgets
      flexCfg("column", [
        panelCfg("News", "rss", { flex: 2 }),
        { text: "Quick notes", title: "Notes" },
        panelCfg("Social", "mastodon", { flex: 1 }),
        { image: "https://example.com/footer.png", alt: "Footer" },
        { iframe: "https://example.com/chat", title: "Chat" },
      ], { flex: 2 }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["News", { items: [makeItem({ title: "Breaking" })] }],
      ["Social", { items: [] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    // Verify all widget types are present
    const images = html.match(/class="image-widget"/g);
    expect(images?.length).toBe(5);
    const texts = html.match(/class="panel text-widget"/g);
    expect(texts?.length).toBe(3);
    const iframes = html.match(/class="iframe-panel"/g);
    expect(iframes?.length).toBe(3);
    // Verify panels
    expect(html).toContain("<h2>News</h2>");
    expect(html).toContain("<h2>Social</h2>");
    expect(html).toContain("Breaking");
    // Container count: root + 3 columns = 4
    const containers = html.match(/class="flex-container"/g);
    expect(containers?.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 6. Cross-cutting: collectPanels + rendering agree on structure
// ---------------------------------------------------------------------------

describe("layout rendering: panels vs widgets", () => {
  it("3 panels in layout produce 3 refresh buttons", () => {
    const layout = flexCfg("row", [
      { text: "Widget A" },
      panelCfg("P1", "s1"),
      { image: "https://example.com/img.png" },
      flexCfg("column", [
        panelCfg("P2", "s2"),
        { iframe: "https://example.com/f" },
        panelCfg("P3", "s3"),
      ]),
    ]);
    const panelData = new Map<string, PanelData>([
      ["P1", { items: [] }],
      ["P2", { items: [] }],
      ["P3", { items: [] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    const refreshBtns = html.match(/class="refresh-btn"/g);
    expect(refreshBtns?.length).toBe(3);
  });

  it("counter display panel renders stat-card while regular panel renders panel-body", () => {
    const layout = flexCfg("row", [
      panelCfg("Stats", "counter", { display: "counter" }),
      { text: "Description" },
      panelCfg("Feed", "rss"),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Stats", { items: [makeItem({ title: "CPU", body: JSON.stringify({ value: 85, unit: "%" }) })] }],
      ["Feed", { items: [makeItem({ title: "Article" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("counter-panel");
    expect(html).toContain("stat-card");
    expect(html).toContain("panel-body");
    expect(html).toContain("Article");
  });
});

// ---------------------------------------------------------------------------
// 7. Edge cases in layout rendering
// ---------------------------------------------------------------------------

describe("layout rendering edge cases", () => {
  it("alternating row/column directions are preserved through deep nesting", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        flexCfg("row", [
          flexCfg("column", [
            { text: "Leaf" },
          ]),
        ]),
      ]),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    const rows = html.match(/flex-direction:row/g);
    const cols = html.match(/flex-direction:column/g);
    expect(rows?.length).toBe(2);
    expect(cols?.length).toBe(2);
  });

  it("container with many children (25) all render in order", () => {
    const children: LayoutNodeConfig[] = [];
    for (let i = 0; i < 25; i++) {
      children.push({ text: `ITEM_${String(i).padStart(2, "0")}` });
    }
    const layout = flexCfg("row", children);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // Verify order
    let lastPos = -1;
    for (let i = 0; i < 25; i++) {
      const marker = `ITEM_${String(i).padStart(2, "0")}`;
      const pos = html.indexOf(marker);
      expect(pos).toBeGreaterThan(lastPos);
      lastPos = pos;
    }
    const textWidgets = html.match(/class="panel text-widget"/g);
    expect(textWidgets?.length).toBe(25);
  });
});
