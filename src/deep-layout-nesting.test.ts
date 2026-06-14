import { describe, it, expect } from "bun:test";
import { renderDashboard, type PanelData } from "./layout";
import { flexCfg, panelCfg } from "./test/layout-cfg";
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

  it("6 levels deep with widget at every other level", () => {
    const layout = flexCfg("row", [
      { text: "Level 1", title: "L1" },
      flexCfg("column", [
        flexCfg("row", [
          { image: "https://example.com/l3.png", alt: "L3" },
          flexCfg("column", [
            flexCfg("row", [
              { iframe: "https://example.com/l5" },
              flexCfg("column", [
                { text: "Level 6 leaf", title: "L6" },
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("<h2>L1</h2>");
    expect(html).toContain('alt="L3"');
    expect(html).toContain('src="https://example.com/l5"');
    expect(html).toContain("<h2>L6</h2>");
    const containers = html.match(/class="flex-container"/g);
    expect(containers?.length).toBe(6);
  });

  it("widget inside row inside column inside row renders correctly", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        flexCfg("row", [
          { text: "Inner widget", flex: 2 },
          panelCfg("Feed", "rss", { flex: 1 }),
        ]),
      ]),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Feed", { items: [makeItem({ title: "News" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("Inner widget");
    expect(html).toContain("News");
    expect(html).toContain("flex:2;");
    expect(html).toContain("flex-direction:row");
    expect(html).toContain("flex-direction:column");
    const containers = html.match(/class="flex-container"/g);
    expect(containers?.length).toBe(3);
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

  it("widget as the only child of a container renders without issues", () => {
    const layout = flexCfg("column", [
      { text: "Solo child" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("Solo child");
    expect(html).toContain("text-widget");
    const containers = html.match(/class="flex-container"/g);
    expect(containers?.length).toBe(1);
    const flexPanels = html.match(/class="flex-panel"/g);
    expect(flexPanels?.length).toBe(1);
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
  it("row with 3 widgets: flex:1, flex:2, flex:1", () => {
    const layout = flexCfg("row", [
      { text: "A", flex: 1 },
      { text: "B", flex: 2 },
      { text: "C", flex: 1 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // Count flex:1 and flex:2 occurrences (root container also has flex:1)
    const flex1 = html.match(/flex:1;/g);
    const flex2 = html.match(/flex:2;/g);
    // 2 widgets with flex:1 + 1 container with flex:1 = at least 3
    expect(flex1!.length).toBeGreaterThanOrEqual(3);
    // Exactly 1 widget with flex:2
    expect(flex2!.length).toBe(1);
    // All three text widgets render
    expect(html).toContain("text-widget");
  });

  it("column with image widget (flex:1) + iframe widget (flex:3)", () => {
    const layout = flexCfg("column", [
      { image: "https://example.com/img.png", flex: 1 },
      { iframe: "https://example.com/embed", flex: 3 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:3;");
    expect(html).toContain("image-widget");
    expect(html).toContain("iframe-panel");
  });

  it("container with panels and widgets mixed, all with flex values", () => {
    const layout = flexCfg("row", [
      panelCfg("Feed", "rss", { flex: 2 }),
      { text: "Sidebar", flex: 1 },
      { image: "https://example.com/ad.png", flex: 1 },
      { iframe: "https://example.com/stats", flex: 3 },
      panelCfg("News", "hn", { flex: 2 }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Feed", { items: [] }],
      ["News", { items: [] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("flex:2;");
    expect(html).toContain("flex:3;");
    // 5 flex-panel wrappers (2 panels + 3 widgets)
    const flexPanels = html.match(/class="flex-panel"/g);
    expect(flexPanels?.length).toBe(5);
  });

  it("widget with no flex value gets default flex:1", () => {
    const layout = flexCfg("row", [
      { text: "No flex specified" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // The flex-panel wrapper should get flex:1
    expect(html).toContain('class="flex-panel" style="flex:1;');
  });

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

  it("row with 5 widgets: flex values 1,2,3,4,5 are all present in output", () => {
    const layout = flexCfg("row", [
      { text: "W1", flex: 1 },
      { text: "W2", flex: 2 },
      { text: "W3", flex: 3 },
      { text: "W4", flex: 4 },
      { text: "W5", flex: 5 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`flex:${i};`);
    }
    const textWidgets = html.match(/class="panel text-widget"/g);
    expect(textWidgets?.length).toBe(5);
  });

  it("nested containers: outer flex:1, inner flex:3, child widgets flex:2 each", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        { text: "Child A", flex: 2 },
        { text: "Child B", flex: 2 },
      ], { flex: 3 }),
    ], { flex: 1 });
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:3;");
    // flex:2 for both children
    const flex2 = html.match(/flex:2;/g);
    expect(flex2?.length).toBe(2);
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

  it("mixed panels and widgets preserve source order", () => {
    const layout = flexCfg("column", [
      { text: "ORDER_TEXT_1" },
      panelCfg("ORDER_PANEL_1", "rss"),
      { image: "https://example.com/ORDER_IMG.png" },
      panelCfg("ORDER_PANEL_2", "hn"),
      { iframe: "https://example.com/ORDER_IFRAME" },
    ]);
    const panelData = new Map<string, PanelData>([
      ["ORDER_PANEL_1", { items: [] }],
      ["ORDER_PANEL_2", { items: [] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    const positions = [
      html.indexOf("ORDER_TEXT_1"),
      html.indexOf("ORDER_PANEL_1"),
      html.indexOf("ORDER_IMG"),
      html.indexOf("ORDER_PANEL_2"),
      html.indexOf("ORDER_IFRAME"),
    ];
    for (let i = 0; i < positions.length - 1; i++) {
      expect(positions[i]).toBeLessThan(positions[i + 1]!);
    }
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

  it("two identical image widgets both render at distinct positions", () => {
    const layout = flexCfg("column", [
      { image: "https://example.com/same.png", alt: "Same" },
      { text: "Separator" },
      { image: "https://example.com/same.png", alt: "Same" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    const imgMatches = html.match(/src="https:\/\/example\.com\/same\.png"/g);
    expect(imgMatches?.length).toBe(2);
  });

  it("two identical iframes both render", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com/embed" },
      { iframe: "https://example.com/embed" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    const iframeMatches = html.match(/src="https:\/\/example\.com\/embed"/g);
    expect(iframeMatches?.length).toBe(2);
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

  it("order preserved across 3 nesting levels with interleaved nodes", () => {
    const layout = flexCfg("row", [
      { text: "A" },
      flexCfg("column", [
        { text: "B" },
        flexCfg("row", [
          { text: "C" },
          { text: "D" },
        ]),
        { text: "E" },
      ]),
      { text: "F" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // All should be present, and in depth-first order: A, B, C, D, E, F
    const posA = html.indexOf(">A<");
    const posB = html.indexOf(">B<");
    const posC = html.indexOf(">C<");
    const posD = html.indexOf(">D<");
    const posE = html.indexOf(">E<");
    const posF = html.indexOf(">F<");
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posC);
    expect(posC).toBeLessThan(posD);
    expect(posD).toBeLessThan(posE);
    expect(posE).toBeLessThan(posF);
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
        { text: "# Dashboard", format: "markdown" as const, title: "Header" },
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

  it("mixed valid node types at various depths all produce output", () => {
    const layout = flexCfg("row", [
      panelCfg("Top Panel", "rss"),
      flexCfg("column", [
        { image: "https://example.com/level2.png", object_fit: "cover", max_height: "150px" },
        { text: "## Level 2 text", format: "markdown" as const },
        flexCfg("row", [
          { iframe: "https://example.com/level3", height: "200px", sandbox: "allow-scripts" },
          panelCfg("Deep Panel", "hn", { display: "counter" }),
        ]),
      ]),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Top Panel", { items: [makeItem({ title: "Item" })] }],
      ["Deep Panel", { items: [makeItem({ title: "Counter", body: JSON.stringify({ value: 42 }) })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    // Image with all props
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("max-height:150px");
    // Markdown rendered
    expect(html).toContain("<h2");
    expect(html).toContain("Level 2 text");
    // Iframe with explicit height
    expect(html).toContain("height:200px");
    expect(html).toContain('sandbox="allow-scripts"');
    // Counter panel
    expect(html).toContain("stat-card");
    expect(html).toContain("42");
    // Regular panel
    expect(html).toContain("Item");
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

  it("widget-only layout has no refresh buttons at all", () => {
    const layout = flexCfg("row", [
      { text: "Hello" },
      { image: "https://example.com/pic.png" },
      { iframe: "https://example.com/embed" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).not.toContain("refresh-btn");
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

  it("widget with all optional props set renders each one", () => {
    const layout = flexCfg("row", [
      {
        image: "https://example.com/full.png",
        alt: "Full",
        flex: 2,
        object_fit: "cover" as const,
        max_height: "300px",
        link: "https://example.com",
      },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain('src="https://example.com/full.png"');
    expect(html).toContain('alt="Full"');
    expect(html).toContain("flex:2;");
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("max-height:300px");
    expect(html).toContain('href="https://example.com"');
  });

  it("text widget with all props renders title, format, and flex", () => {
    const layout = flexCfg("row", [
      { text: "**Bold text**", format: "markdown" as const, title: "My Title", flex: 3 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("<h2>My Title</h2>");
    expect(html).toContain("<strong>Bold text</strong>");
    expect(html).toContain("flex:3;");
  });

  it("iframe widget with all props renders each attribute", () => {
    const layout = flexCfg("row", [
      {
        iframe: "https://example.com/embed",
        flex: 4,
        title: "My Frame",
        height: "500px",
        sandbox: "allow-scripts allow-popups",
        allow: "fullscreen",
      },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain('src="https://example.com/embed"');
    expect(html).toContain("flex:4;");
    expect(html).toContain("<h2>My Frame</h2>");
    expect(html).toContain("height:500px");
    expect(html).toContain('sandbox="allow-scripts allow-popups"');
    expect(html).toContain('allow="fullscreen"');
    // height takes priority over aspect_ratio
    expect(html).not.toContain("aspect-ratio:");
  });
});
