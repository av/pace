import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { validateParsedConfig } from "./config-validate";
import { renderDashboard, type PanelData } from "./layout";
import { collectPanels, resolvePanelId } from "./layout/types";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import type { TextWidgetConfig } from "./config/types";

const STYLES = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");

const LONG_TITLE =
  "This Is An Extremely Long Panel Title That Should Truncate With Ellipsis Instead Of Wrapping To Multiple Lines";

/** Extract a CSS rule block by selector (first top-level rule match). */
function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = STYLES.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "s"));
  expect(match).not.toBeNull();
  return match![1];
}

describe("panel header title truncation CSS", () => {
  it(".panel-header h2 uses ellipsis overflow instead of wrapping", () => {
    const block = ruleBlock(".panel-header h2");
    expect(block).toContain("min-width: 0");
    expect(block).toContain("flex: 1 1 auto");
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("text-overflow: ellipsis");
    expect(block).toContain("white-space: nowrap");
  });

  it(".panel-header allows title to shrink and panel-actions stay fixed", () => {
    const header = ruleBlock(".panel-header");
    expect(header).toContain("min-width: 0");
    expect(header).toContain("gap: 0.5rem");

    const actions = ruleBlock(".panel-actions");
    expect(actions).toContain("flex-shrink: 0");
  });

  it(".flex-panel > .panel participates in ellipsis shrink chain", () => {
    const blocks = [...STYLES.matchAll(/\.flex-panel > \.panel\s*\{([^}]*)\}/gs)].map((m) => m[1]);
    expect(blocks.some((b) => b.includes("min-width: 0"))).toBe(true);
  });
});

describe("panel header long title HTML", () => {
  it("renders truncated titles with title tooltip on counter, regular panel, and text widget", () => {
    const counterItem = makeItem({
      title: "Metric",
      body: JSON.stringify({ value: 42, unit: "count" }),
      source: "counter",
    });
    const feedItem = makeItem({ title: "Story", source: "rss" });

    const counterName = `${LONG_TITLE} Counter`;
    const feedName = `${LONG_TITLE} Feed`;
    const textTitle = `${LONG_TITLE} Text`;

    const layout2 = flexCfg("column", [
      panelCfg(counterName, "counter", { display: "counter" }),
      panelCfg(feedName, "rss"),
      { text: "Body", title: textTitle } as TextWidgetConfig,
    ]);
    const panelData2 = new Map<string, PanelData>([
      [counterName, { items: [counterItem] }],
      [feedName, { items: [feedItem] }],
    ]);

    const html = renderDashboard({ layout: layout2, panelData: panelData2, updatedAt: "now" });

    for (const name of [counterName, feedName, textTitle]) {
      expect(html).toContain(`<h2 title="${name}">${name}</h2>`);
      expect(html).toContain(`class="panel-header"`);
    }

    const headers = html.match(/class="panel-header"/g);
    expect(headers?.length).toBe(3);
  });
});

describe("counter panel narrow-width CSS", () => {
  it(".counter-panel grid wraps multi-card rows and shrinks single-card panels", () => {
    const block = ruleBlock(".counter-panel");
    expect(block).toContain("grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr))");
    expect(block).toContain("min-width: 0");
    expect(block).not.toContain("container-type");
  });

  it(".stat-value scales with clamp and keeps ellipsis overflow rules", () => {
    const block = ruleBlock(".stat-value");
    expect(block).toContain("font-size: 1.75rem");
    expect(block).toContain("font-size: clamp(1rem, 6cqi, 1.75rem)");
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("text-overflow: ellipsis");
    expect(block).toContain("white-space: nowrap");
  });

  it(".stat-label keeps ellipsis overflow rules and can shrink", () => {
    const block = ruleBlock(".stat-label");
    expect(block).toContain("min-width: 0");
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("text-overflow: ellipsis");
    expect(block).toContain("white-space: nowrap");
  });

  it(".stat-card shrinks with container queries and clamp padding", () => {
    const block = ruleBlock(".stat-card");
    expect(block).toContain("min-width: 0");
    expect(block).toContain("container-type: inline-size");
    expect(block).toContain("padding: 1rem");
    expect(block).toContain("padding: clamp(0.5rem, 2cqi, 1rem)");
  });

  it("counter panels hide the bottom scroll gradient", () => {
    expect(STYLES).toContain(".panel:has(.counter-panel)::after");
    expect(STYLES).toContain("display: none");
  });
});

describe("widgets-gallery weather counter row HTML structure", () => {
  const galleryPath = join(import.meta.dir, "../examples/widgets-gallery.yaml");

  it("renders Berlin, New York, and Tokyo counter panels with headers and actions", () => {
    const raw = readFileSync(galleryPath, "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown>;
    const validated = validateParsedConfig(parsed);

    const panels = collectPanels(validated.layout);
    const weatherPanels = panels.filter((p) => p.display === "counter");
    expect(weatherPanels.map((p) => p.panel).sort()).toEqual(["Berlin", "New York", "Tokyo"]);

    const panelData = new Map<string, PanelData>();
    for (const panel of weatherPanels) {
      panelData.set(panel.panel, {
        panelId: resolvePanelId(panel),
        items: [
          makeItem({
            title: panel.panel,
            body: JSON.stringify({ value: 22, unit: "°C" }),
            source: typeof panel.source === "string" ? panel.source : "counter",
          }),
        ],
        lastRefreshedAt: new Date().toISOString(),
      });
    }

    const html = renderDashboard({
      layout: validated.layout,
      panelData,
      updatedAt: "2026-06-18 12:00",
    });

    for (const name of ["Berlin", "New York", "Tokyo"]) {
      expect(html).toContain(`<h2 title="${name}">${name}</h2>`);
    }

    const counterPanels = html.match(/class="counter-panel"/g);
    expect(counterPanels?.length).toBe(3);

    const panelHeaders = html.match(/class="panel-header"/g);
    expect(panelHeaders!.length).toBeGreaterThanOrEqual(3);

    const panelActions = html.match(/class="panel-actions"/g);
    expect(panelActions!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("three-panel counter row HTML", () => {
  it("renders three flex:1 counter panels each with stat-card data", () => {
    const cities = ["Berlin", "New York", "Tokyo"] as const;
    const panelData = new Map<string, PanelData>();
    for (const city of cities) {
      panelData.set(city, {
        items: [
          makeItem({
            title: city,
            body: JSON.stringify({ value: 18, unit: "°C" }),
            source: "counter:weather",
          }),
        ],
      });
    }

    const layout = flexCfg("row", cities.map((city) =>
      panelCfg(city, "weather", { display: "counter", flex: 1 }),
    ));
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    expect(html.match(/class="counter-panel"/g)?.length).toBe(3);
    expect(html.match(/class="stat-card"/g)?.length).toBe(3);

    for (const city of cities) {
      expect(html).toContain(`<h2 title="${city}">${city}</h2>`);
    }

    expect(html).toContain("flex:1;");
    expect(html).not.toContain("No data yet");
  });
});