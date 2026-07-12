import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderDashboard, type PanelData } from "./layout";
import { makeContentItemRow } from "./test/content-items";

const styles = readFileSync(join(import.meta.dir, "styles.css"), "utf8");

describe("responsive tall media widgets", () => {
  test("caps desktop media while preserving natural mobile image and iframe sizing", () => {
    const html = renderDashboard({
      layout: {
        direction: "column",
        children: [
          { image: "https://example.com/portrait.svg", alt: "Portrait timeline" },
          { iframe: "https://example.com/portrait", title: "Portrait view", height: "1200px" },
          { panel: "Follow-up", id: "follow-up", source: "bookmarks" },
        ],
      },
      panelData: new Map<string, PanelData>([["Follow-up", {
        panelId: "follow-up",
        items: [makeContentItemRow({ id: "next", title: "Reachable follow-up" })],
      }]]),
      updatedAt: "now",
    });

    expect(html).toContain("Portrait timeline");
    expect(html).toContain("height:1200px");
    expect(html).toContain("Reachable follow-up");
    expect(styles).toMatch(/@media \(max-width: 768px\)[\s\S]*\.flex-container \{[\s\S]*width: 100%;[\s\S]*max-width: 100%/);
    expect(styles).toMatch(/@media \(min-width: 769px\)[\s\S]*\.flex-panel:has\(> \.image-widget\),[\s\S]*\.flex-panel:has\(> \.iframe-panel\)[\s\S]*max-height: 70vh/);
    expect(styles).toMatch(/@media \(max-width: 768px\)[\s\S]*\.flex-panel:has\(> \.image-widget\)[\s\S]*max-width: 100%;[\s\S]*\.image-widget \{[\s\S]*height: auto;[\s\S]*width: 100%;[\s\S]*\.image-widget img \{[\s\S]*width: 100% !important;[\s\S]*height: auto !important;[\s\S]*max-height: none !important/);
  });
});
