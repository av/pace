import { describe, it, expect } from "bun:test";
import { flexStyle, flexContainerStyle } from "./flex-styles";
import { renderDashboard, type PanelData } from "../layout";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import { makeContentItemRow as makeItem } from "../test/content-items";

describe("flexStyle", () => {
  it("defaults flex to 1 when omitted", () => {
    expect(flexStyle()).toBe("flex:1;");
  });

  it("uses explicit flex value", () => {
    expect(flexStyle(3)).toBe("flex:3;");
  });

  it("handles flex: 0.5 (fractional)", () => {
    expect(flexStyle(0.5)).toBe("flex:0.5;");
  });

  it("handles flex: 2 (integer greater than 1)", () => {
    expect(flexStyle(2)).toBe("flex:2;");
  });

  it("handles flex: 0.1 (small fraction)", () => {
    expect(flexStyle(0.1)).toBe("flex:0.1;");
  });

  it("handles flex: 10 (large value)", () => {
    expect(flexStyle(10)).toBe("flex:10;");
  });

  it("handles flex: 1.5 (mixed fraction)", () => {
    expect(flexStyle(1.5)).toBe("flex:1.5;");
  });

  it("handles flex: 0.333 (repeating-like decimal)", () => {
    expect(flexStyle(0.333)).toBe("flex:0.333;");
  });

  it("passes through undefined as flex:1 (nullish coalescing)", () => {
    expect(flexStyle(undefined)).toBe("flex:1;");
  });
});

describe("flexContainerStyle", () => {
  it("builds row container with default gap and flex", () => {
    expect(flexContainerStyle({ direction: "row", children: [] })).toBe(
      "display:flex; flex-direction:row; gap:1rem; flex:1;",
    );
  });

  it("respects explicit gap and flex", () => {
    expect(flexContainerStyle({ direction: "column", gap: "2rem", flex: 3, children: [] })).toBe(
      "display:flex; flex-direction:column; gap:2rem; flex:3;",
    );
  });

  it("always includes display:flex", () => {
    const style = flexContainerStyle({ direction: "row", children: [] });
    expect(style).toContain("display:flex");
  });

  it("applies flex-direction:column for column containers", () => {
    const style = flexContainerStyle({ direction: "column", children: [] });
    expect(style).toContain("flex-direction:column");
  });

  it("uses fractional flex on containers", () => {
    const style = flexContainerStyle({ direction: "row", flex: 0.5, children: [] });
    expect(style).toContain("flex:0.5;");
  });

  it("uses custom gap value", () => {
    const style = flexContainerStyle({ direction: "row", gap: "0.5rem", children: [] });
    expect(style).toContain("gap:0.5rem");
  });

  it("defaults gap to 1rem when not specified", () => {
    const style = flexContainerStyle({ direction: "row", children: [] });
    expect(style).toContain("gap:1rem");
  });
});

// Integration tests: render through renderDashboard and verify flex values in HTML output

describe("flex layout integration: widget flex values in containers", () => {
  it("widget with flex:2 gets double flex value compared to flex:1 widget", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/a.png", flex: 1 },
      { image: "https://example.com/b.png", flex: 2 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:1;");
    expect(html).toContain("flex:2;");
    // Both flex-panel wrappers present
    const flexPanelMatches = html.match(/class="flex-panel"/g);
    expect(flexPanelMatches?.length).toBe(2);
  });

  it("three widgets with flex:1, flex:2, flex:3 all have correct flex values", () => {
    const layout = flexCfg("row", [
      { text: "One", flex: 1 },
      { text: "Two", flex: 2 },
      { text: "Three", flex: 3 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:1;");
    expect(html).toContain("flex:2;");
    expect(html).toContain("flex:3;");
  });
});

describe("flex layout integration: mixed widget/panel flex", () => {
  it("widget with flex:0.5 next to panel with flex:1.5 in a row container", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/side.png", flex: 0.5 },
      panelCfg("Main Feed", "rss", { flex: 1.5 }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Main Feed", { items: [makeItem({ title: "Article" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("flex:0.5;");
    expect(html).toContain("flex:1.5;");
    expect(html).toContain("image-widget");
    expect(html).toContain("Article");
  });

  it("text widget flex:1 and iframe widget flex:2 in same container", () => {
    const layout = flexCfg("column", [
      { text: "Description", flex: 1 },
      { iframe: "https://example.com/embed", flex: 2 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:1;");
    expect(html).toContain("flex:2;");
    expect(html).toContain("text-widget");
    expect(html).toContain("iframe-panel");
  });
});

describe("flex layout integration: default flex (no value)", () => {
  it("widget without explicit flex value gets flex:1", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/pic.png" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // The flex-panel wrapper should have flex:1 (default)
    expect(html).toContain("flex:1;");
  });

  it("text widget without flex gets flex:1", () => {
    const layout = flexCfg("row", [
      { text: "Hello" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:1;");
  });

  it("iframe widget without flex gets flex:1", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:1;");
  });

  it("panel without flex gets flex:1", () => {
    const layout = flexCfg("row", [
      panelCfg("Feed", "rss"),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Feed", { items: [] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("flex:1;");
  });

  it("container without flex gets flex:1", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [{ text: "inner" }]),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // The inner container style should contain flex:1
    expect(html).toContain("flex-direction:column");
    expect(html).toContain("flex:1;");
  });
});

describe("flex layout integration: nested containers with widgets", () => {
  it("row containing [panel flex:1, column flex:2 containing [text widget, image widget]]", () => {
    const layout = flexCfg("row", [
      panelCfg("News", "rss", { flex: 1 }),
      flexCfg("column", [
        { text: "Welcome text", title: "Welcome" },
        { image: "https://example.com/banner.png", alt: "Banner" },
      ], { flex: 2 }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["News", { items: [makeItem({ title: "Story" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Root row container
    expect(html).toContain("flex-direction:row");
    // Nested column container with flex:2
    expect(html).toContain("flex-direction:column");
    expect(html).toContain("flex:2;");
    // Panel with flex:1
    expect(html).toContain("flex:1;");
    // Widget content present
    expect(html).toContain("Welcome text");
    expect(html).toContain('src="https://example.com/banner.png"');
    expect(html).toContain("Story");
    // Two flex-containers (root row + nested column)
    const containerMatches = html.match(/class="flex-container"/g);
    expect(containerMatches?.length).toBe(2);
  });

  it("column containing [iframe flex:3, row flex:1 containing [image, image]]", () => {
    const layout = flexCfg("column", [
      { iframe: "https://grafana.example.com", flex: 3 },
      flexCfg("row", [
        { image: "https://example.com/left.png", alt: "Left" },
        { image: "https://example.com/right.png", alt: "Right" },
      ], { flex: 1 }),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    // Outer column
    expect(html).toContain("flex-direction:column");
    // Iframe with flex:3
    expect(html).toContain("flex:3;");
    // Inner row with flex:1
    expect(html).toContain("flex-direction:row");
    // Both images rendered
    expect(html).toContain('alt="Left"');
    expect(html).toContain('alt="Right"');
    // Iframe rendered
    expect(html).toContain('src="https://grafana.example.com"');
  });

  it("deeply nested: row > column > row with widgets at each level", () => {
    const layout = flexCfg("row", [
      { text: "Top level text", flex: 1 },
      flexCfg("column", [
        { image: "https://example.com/mid.png", flex: 2 },
        flexCfg("row", [
          { iframe: "https://example.com/deep", flex: 1 },
          { text: "Deep text", flex: 3 },
        ], { flex: 1 }),
      ], { flex: 2 }),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    // Three levels of flex containers
    const containerMatches = html.match(/class="flex-container"/g);
    expect(containerMatches?.length).toBe(3);
    // All widget types present
    expect(html).toContain("text-widget");
    expect(html).toContain("image-widget");
    expect(html).toContain("iframe-panel");
    // Flex values distributed
    expect(html).toContain("flex:3;");
  });
});

describe("flex layout integration: widget-only layouts (no panels)", () => {
  it("row of only widgets (no panels at all)", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/1.png", flex: 1 },
      { text: "Some text", flex: 1 },
      { iframe: "https://example.com", flex: 1 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    // All three widget types rendered
    expect(html).toContain("image-widget");
    expect(html).toContain("text-widget");
    expect(html).toContain("iframe-panel");
    // No regular panel elements (no refresh button, no panel-body)
    expect(html).not.toContain("refresh-btn");
    expect(html).not.toContain("panel-body");
    // Three flex-panel wrappers
    const flexPanelMatches = html.match(/class="flex-panel"/g);
    expect(flexPanelMatches?.length).toBe(3);
  });

  it("column of two text widgets", () => {
    const layout = flexCfg("column", [
      { text: "First block", title: "Block 1", flex: 1 },
      { text: "Second block", title: "Block 2", flex: 2 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    expect(html).toContain("Block 1");
    expect(html).toContain("Block 2");
    expect(html).toContain("flex:1;");
    expect(html).toContain("flex:2;");
    expect(html).toContain("flex-direction:column");
  });

  it("grid-like layout with only image widgets", () => {
    const layout = flexCfg("column", [
      flexCfg("row", [
        { image: "https://example.com/tl.png" },
        { image: "https://example.com/tr.png" },
      ]),
      flexCfg("row", [
        { image: "https://example.com/bl.png" },
        { image: "https://example.com/br.png" },
      ]),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    // 4 images
    const imgMatches = html.match(/class="image-widget"/g);
    expect(imgMatches?.length).toBe(4);
    // 3 flex-containers (1 column + 2 rows)
    const containerMatches = html.match(/class="flex-container"/g);
    expect(containerMatches?.length).toBe(3);
  });
});

describe("flex layout integration: single widget in container", () => {
  it("single image widget takes full width (flex:1 default)", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/solo.png" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    expect(html).toContain("flex:1;");
    expect(html).toContain("image-widget");
    const flexPanelMatches = html.match(/class="flex-panel"/g);
    expect(flexPanelMatches?.length).toBe(1);
  });

  it("single text widget in column takes full height (flex:1 default)", () => {
    const layout = flexCfg("column", [
      { text: "Solo text" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    expect(html).toContain("flex:1;");
    expect(html).toContain("text-widget");
    expect(html).toContain("flex-direction:column");
  });

  it("single iframe widget in container", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com/embed" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    expect(html).toContain("flex:1;");
    expect(html).toContain("iframe-panel");
  });

  it("single widget with explicit flex:5 in container", () => {
    const layout = flexCfg("row", [
      { text: "Expanded", flex: 5 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    expect(html).toContain("flex:5;");
  });
});

describe("flex layout integration: fractional flex values and normalization", () => {
  it("flex:0.5 renders correctly as style value", () => {
    expect(flexStyle(0.5)).toBe("flex:0.5;");
  });

  it("flex:0.25 renders correctly", () => {
    expect(flexStyle(0.25)).toBe("flex:0.25;");
  });

  it("flex:1.75 renders correctly", () => {
    expect(flexStyle(1.75)).toBe("flex:1.75;");
  });

  it("widgets with fractional flex values render in HTML", () => {
    const layout = flexCfg("row", [
      { text: "Quarter", flex: 0.25 },
      { text: "Three quarters", flex: 0.75 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:0.25;");
    expect(html).toContain("flex:0.75;");
  });

  it("container with fractional flex wrapping widgets", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        { text: "A" },
      ], { flex: 0.3 }),
      flexCfg("column", [
        { text: "B" },
      ], { flex: 0.7 }),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:0.3;");
    expect(html).toContain("flex:0.7;");
  });
});

describe("flex layout integration: flexStyle works for all widget types", () => {
  it("image widget uses flexStyle in its container style", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/pic.png", flex: 4 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:4;");
  });

  it("text widget uses flexStyle in its container style", () => {
    const layout = flexCfg("row", [
      { text: "Content", flex: 3 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:3;");
  });

  it("iframe widget uses flexStyle in its container style", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com", flex: 2.5 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:2.5;");
  });

  it("panel uses flexStyle in its container style", () => {
    const layout = flexCfg("row", [
      panelCfg("Feed", "rss", { flex: 7 }),
    ]);
    const panelData = new Map<string, PanelData>([["Feed", { items: [] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("flex:7;");
  });
});

describe("flex layout integration: display:flex on containers wrapping widgets", () => {
  it("row container wrapping widgets has display:flex", () => {
    const layout = flexCfg("row", [
      { text: "A" },
      { text: "B" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("display:flex");
    expect(html).toContain("flex-direction:row");
  });

  it("column container wrapping widgets has display:flex", () => {
    const layout = flexCfg("column", [
      { image: "https://example.com/a.png" },
      { iframe: "https://example.com" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("display:flex");
    expect(html).toContain("flex-direction:column");
  });

  it("nested containers both have display:flex", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        { text: "inner" },
      ]),
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // Both containers should have display:flex
    const displayFlexMatches = html.match(/display:flex/g);
    expect(displayFlexMatches?.length).toBe(2);
  });
});

describe("flex layout integration: test gap coverage", () => {
  it("flexStyle with 0 produces flex:none (natural size, no grow)", () => {
    // flex:0 shorthand means grow=0 shrink=1 basis=0, which collapses the
    // element to zero size. flex:none (= 0 0 auto) keeps natural size.
    expect(flexStyle(0)).toBe("flex:none;");
  });

  it("flexContainerStyle with zero-gap", () => {
    const style = flexContainerStyle({ direction: "row", gap: "0", children: [] });
    expect(style).toContain("gap:0");
  });

  it("flexContainerStyle with pixel gap", () => {
    const style = flexContainerStyle({ direction: "row", gap: "8px", children: [] });
    expect(style).toContain("gap:8px");
  });

  it("container and children flex values are independent", () => {
    const layout = flexCfg("row", [
      { text: "Child", flex: 3 },
    ], { flex: 5 });
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // Container has flex:5, child has flex:3
    expect(html).toContain("flex:5;");
    expect(html).toContain("flex:3;");
  });

  it("all children default to flex:1 when none specify flex", () => {
    const layout = flexCfg("row", [
      { text: "A" },
      { image: "https://example.com/b.png" },
      { iframe: "https://example.com/c" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    // All three children + the container itself should produce flex:1
    const flex1Matches = html.match(/flex:1;/g);
    // Container flex:1 + 3 children flex:1 = 4 occurrences
    expect(flex1Matches?.length).toBe(4);
  });
});