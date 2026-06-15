import { describe, it, expect } from "bun:test";
import { getAllItemsByPanel, saveItems } from "./db";
import { installTempDbHooks } from "./test/temp-db";
import {
  installSchedulerRuntimeHooks,
  refreshTestSources,
  startTestScheduler,
} from "./test/scheduler-test-harness";
import { isPanel, type LayoutNodeConfig, type PanelConfig } from "./config/types";
import { DOMAIN_TEST_LAYOUT, testAppConfig } from "./test/app-config";
import { makeContentItem } from "./test/content-items";
import { sourcePanelMapFromConfig } from "./test/panel-map";

describe("domain", () => {
  installTempDbHooks({ prefix: "pace-domain-test-" });
  installSchedulerRuntimeHooks();

  it("layout panel source all bypass", () => {
    const layout = {
      direction: "column",
      children: [
        { panel: "global", source: "all" },
        { panel: "tech", source: "hackernews" },
        { panel: "pipe", source: "my-pipe" },
      ] as LayoutNodeConfig[],
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
    startTestScheduler(config, new Map(), pm, null);
    await refreshTestSources(["merge"]);
    const out = getAllItemsByPanel("outPanel");
    expect(out.map((r) => r.id).sort()).toEqual(["pipeline:merge:b1", "pipeline:merge:b2"]);
    expect(out.find((r) => r.id === "pipeline:merge:b1")?.title).toBe("Dup story (new)");
  });
});