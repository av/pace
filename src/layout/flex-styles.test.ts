import { describe, it, expect } from "bun:test";
import { renderDashboard, type PanelData } from "../layout";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import { makeContentItemRow as makeItem } from "../test/content-items";

describe("flex layout: widgets render with correct flex ratios", () => {
  it("flex:1 vs flex:2 widgets both appear in HTML with correct values", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/a.png", flex: 1 },
      { image: "https://example.com/b.png", flex: 2 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:1;");
    expect(html).toContain("flex:2;");
    const flexPanelMatches = html.match(/class="flex-panel"/g);
    expect(flexPanelMatches?.length).toBe(2);
  });

  it("mixed widget and panel types with fractional flex values", () => {
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

  it("widgets without explicit flex default to flex:1", () => {
    const layout = flexCfg("row", [
      { text: "A" },
      { image: "https://example.com/b.png" },
      { iframe: "https://example.com/c" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    const flex1Matches = html.match(/flex:1;/g);
    // Container flex:1 + 3 children flex:1 = 4 occurrences
    expect(flex1Matches?.length).toBe(4);
  });
});

describe("flex layout: nested containers with widgets", () => {
  it("row > column nesting with panel and widgets renders all content", () => {
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

    expect(html).toContain("flex-direction:row");
    expect(html).toContain("flex-direction:column");
    expect(html).toContain("flex:2;");
    expect(html).toContain("Welcome text");
    expect(html).toContain('src="https://example.com/banner.png"');
    expect(html).toContain("Story");
    const containerMatches = html.match(/class="flex-container"/g);
    expect(containerMatches?.length).toBe(2);
  });
});

describe("flex layout: widget-only layouts (no panels)", () => {
  it("row of only widgets has no refresh buttons or panel-body", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/1.png", flex: 1 },
      { text: "Some text", flex: 1 },
      { iframe: "https://example.com", flex: 1 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });

    expect(html).toContain("image-widget");
    expect(html).toContain("text-widget");
    expect(html).toContain("iframe-panel");
    expect(html).not.toContain("refresh-btn");
    expect(html).not.toContain("panel-body");
    const flexPanelMatches = html.match(/class="flex-panel"/g);
    expect(flexPanelMatches?.length).toBe(3);
  });

  it("2x2 grid with only image widgets", () => {
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

    const imgMatches = html.match(/class="image-widget"/g);
    expect(imgMatches?.length).toBe(4);
    const containerMatches = html.match(/class="flex-container"/g);
    expect(containerMatches?.length).toBe(3);
  });
});

describe("flex layout: flex:0 container gets height:auto override", () => {
  it("container with flex:0 includes height:auto to override CSS height:100%", () => {
    const layout = flexCfg("column", [
      flexCfg("row", [
        { text: "Header", flex: 3 },
      ], { flex: 0 }),
      panelCfg("Feed", "rss", { flex: 1 }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Feed", { items: [makeItem({ title: "Story" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("flex:none;");
    expect(html).toContain("height:auto;");
  });

  it("container without flex:0 does not get height:auto override", () => {
    const layout = flexCfg("row", [
      { text: "A" },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).not.toContain("height:auto;");
  });
});

describe("flex layout: container and child flex values are independent", () => {
  it("container flex:5 with child flex:3 both render correctly", () => {
    const layout = flexCfg("row", [
      { text: "Child", flex: 3 },
    ], { flex: 5 });
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex:5;");
    expect(html).toContain("flex:3;");
  });
});
