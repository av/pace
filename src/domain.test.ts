import { describe, it, expect } from "bun:test";
import { getAllItemsByPanel, saveItems } from "./db";
import { installTempDbHooks } from "./test/temp-db";
import { startScheduler, refreshSources } from "./scheduler";
import { isPanel } from "./config";
import type { PanelConfig } from "./config";
import { DOMAIN_TEST_LAYOUT, testAppConfig } from "./test/app-config";
import { makeContentItem } from "./test/content-items";
import { sourcePanelMapFromConfig } from "./test/panel-map";

describe("domain", () => {
  installTempDbHooks({ prefix: "pace-domain-test-", stopSchedulerOnTeardown: true });

  it("layout panel source all bypass", () => {
    const layout = {
      direction: "column",
      children: [
        { panel: "global", source: "all" },
        { panel: "tech", source: "hackernews" },
        { panel: "pipe", source: "my-pipe" },
      ],
    };
    expect(layout.children.some((c) => isPanel(c) && c.source === "all")).toBe(true);
    const allBypassSources = layout.children
      .filter((c): c is PanelConfig => isPanel(c) && c.source === "all")
      .map((c) => c.source);
    expect(allBypassSources).toEqual(["all"]);
  });

  it("pipeline refresh merges adapter feeds, dedupes by url (latest), persists prefixed rows", async () => {
    const tsOld = "2024-01-01T00:00:00.000Z";
    const tsNew = "2024-06-01T00:00:00.000Z";
    saveItems("feedA", [
      makeContentItem({
        id: "a1",
        title: "Dup story (old)",
        url: "https://news.example/dup",
        source: "feedA",
        timestamp: new Date(tsOld),
      }),
    ]);
    saveItems("feedB", [
      makeContentItem({
        id: "b1",
        title: "Dup story (new)",
        url: "https://news.example/dup",
        source: "feedB",
        timestamp: new Date(tsNew),
      }),
      makeContentItem({
        id: "b2",
        title: "Unique",
        url: "https://news.example/unique",
        source: "feedB",
        timestamp: new Date(tsNew),
      }),
    ]);
    const config = testAppConfig(
      {
        pipelines: [
          {
            name: "merge",
            sources: ["feedA", "feedB"],
            transforms: [{ type: "dedupe", strategy: "url", keep: "latest" }],
          },
        ],
      },
      DOMAIN_TEST_LAYOUT,
    );
    const pm = sourcePanelMapFromConfig(config);
    startScheduler(config, new Map(), pm, null);
    await refreshSources(["merge"]);
    const out = getAllItemsByPanel("outPanel");
    expect(out.map((r) => r.id).sort()).toEqual(["pipeline:merge:b1", "pipeline:merge:b2"]);
    expect(out.find((r) => r.id === "pipeline:merge:b1")?.title).toBe("Dup story (new)");
  });
});