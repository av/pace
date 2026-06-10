import { describe, expect, test } from "bun:test";
import type { Adapter, AdapterConfig, ContentItem } from "../adapters/types";
import type { DashboardPanelSnapshot } from "../db";
import type {
  DashboardPanel,
  LayoutNodeConfig,
  PanelConfig,
  PanelData,
} from "./types";
import {
  LAYOUT_DIRECTIONS,
  allPanelRefreshSourceNames,
  buildLayoutRuntimeMaps,
  isPanel,
  resolvePanelId,
  resolvePanelRefreshSourceNames,
} from "./types";

type AssertPanelDataAlignsWithSnapshot = PanelData extends DashboardPanelSnapshot
  ? DashboardPanelSnapshot extends PanelData
    ? true
    : ["PanelData is narrower than DashboardPanelSnapshot"]
  : ["PanelData is wider than DashboardPanelSnapshot"];

declare const _panelDataDriftGuard: AssertPanelDataAlignsWithSnapshot;

describe("layout/types unified surface", () => {
  test("exports adapter contract types usable by server bootstrap", () => {
    const adapter: Adapter = {
      name: "stub",
      fetch: async (_config: AdapterConfig): Promise<ContentItem[]> => [],
    };
    expect(adapter.name).toBe("stub");
  });

  test("exports layout runtime helpers for dashboard binding", () => {
    const layout: LayoutNodeConfig = { panel: "tech", source: "hackernews", id: "tech-panel" };
    expect(isPanel(layout)).toBe(true);
    expect(resolvePanelId(layout as PanelConfig)).toBe("tech-panel");

    const maps = buildLayoutRuntimeMaps(layout, ["hackernews"]);
    const dashboardPanel: DashboardPanel = maps.dashboardPanels[0]!;
    expect(dashboardPanel.pid).toBe("tech-panel");
    expect(dashboardPanel.isAll).toBe(false);
  });

  test("exports layout direction and refresh source name helpers", () => {
    expect(LAYOUT_DIRECTIONS).toEqual(["row", "column"]);
    expect(allPanelRefreshSourceNames(["hn", "rss"], [{ name: "pipe" }])).toEqual([
      "hn",
      "rss",
      "pipe",
    ]);
    expect(
      resolvePanelRefreshSourceNames([{ adapter: "all" }], ["hn"], [{ name: "pipe" }]),
    ).toEqual(["hn", "pipe"]);
  });
});