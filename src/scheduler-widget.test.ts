import { describe, test, expect, spyOn } from "bun:test";
import { spyConsole, spyMockCallsContaining } from "./test/console-spy";
import { emptyPanelMap, sourcePanelMapFromConfig } from "./test/panel-map";
import { installTempDbHooks } from "./test/temp-db";
import {
  installSchedulerRuntimeHooks,
  refreshTestSources,
  startTestScheduler,
  stopTestScheduler,
} from "./test/scheduler-test-harness";
import type { Adapter } from "./adapters/types";
import { makeContentItem } from "./test/content-items";
import { adaptersMap, makeMockAdapter } from "./test/adapter-mocks";
import * as dbMod from "./db";
import { collectPanels, buildLayoutRuntimeMaps, type DashboardPanel, type LayoutNodeConfig } from "./config/types";
import { testAppConfig, singlePanelLayout, testAppLayout } from "./test/app-config";
import { waitForAsync } from "./test/async";

/**
 * Tests for widget + scheduler interaction edge cases:
 * - Widgets have no adapter, no DB, no refresh cycle
 * - The scheduler should completely ignore them
 * - Counter/bookmarks adapters DO participate in the refresh cycle
 */
describe("scheduler-widget interaction", () => {
  installTempDbHooks({ prefix: "pace-sched-widget-" });
  installSchedulerRuntimeHooks();

  // -- Widget-only config: zero adapters --

  test("widget-only config: startScheduler with zero adapters is safe, sets prune timer", async () => {
    const config = testAppConfig({ adapters: [] });
    const adapters = new Map<string, Adapter>();
    startTestScheduler(config, adapters, emptyPanelMap(), null);
    // should not throw; scheduler just sets up pruning
    const results = await refreshTestSources([]);
    expect(results).toEqual([]);
  });

  test("widget-only config: duplicate startScheduler guard works even with zero adapters", async () => {
    const config = testAppConfig({ adapters: [] });
    const adapters = new Map<string, Adapter>();
    const setIntervalSpy = spyOn(globalThis, "setInterval");
    try {
      startTestScheduler(config, adapters, emptyPanelMap(), null);
      const callsAfterFirst = setIntervalSpy.mock.calls.length;
      // second call should be a no-op (isStarted guard)
      startTestScheduler(config, adapters, emptyPanelMap(), null);
      expect(setIntervalSpy.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test("widget-only config: stopScheduler clears prune timer and allows restart", async () => {
    const config = testAppConfig({ adapters: [] });
    const adapters = new Map<string, Adapter>();
    startTestScheduler(config, adapters, emptyPanelMap(), null);
    stopTestScheduler();
    // After stop, re-start should work (isStarted returns false)
    startTestScheduler(config, adapters, emptyPanelMap(), null);
    const results = await refreshTestSources([]);
    expect(results).toEqual([]);
  });

  // -- Counter adapter refresh: timestamp IDs + URL dedup --

  test("counter adapter items with same URL are deduped by DB (latest wins)", async () => {
    // Simulate two counter refreshes with different IDs but same URL
    const url = "https://api.example.com/stats";
    const item1 = makeContentItem({
      id: "counter:stars:1000",
      title: "Stars",
      url,
      source: "stars",
      timestamp: new Date("2024-06-01T12:00:00Z"),
      body: JSON.stringify({ value: 100 }),
    });
    const item2 = makeContentItem({
      id: "counter:stars:2000",
      title: "Stars",
      url,
      source: "stars",
      timestamp: new Date("2024-06-01T13:00:00Z"),
      body: JSON.stringify({ value: 150 }),
    });

    // Save first batch, then second (simulates two refreshes)
    dbMod.saveItems("counter-panel", [item1]);
    dbMod.saveItems("counter-panel", [item2]);

    // DB dedup by URL should return only the latest
    const items = dbMod.getItemsByPanel("counter-panel");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("counter:stars:2000");
    expect(items[0].body).toContain("150");
  });

  test("counter adapter: limit 1 on panel returns single latest item", async () => {
    const url = "https://api.example.com/count";
    for (let i = 0; i < 5; i++) {
      dbMod.saveItems("limited-panel", [
        makeContentItem({
          id: `counter:c:${i}`,
          title: "Count",
          url: `${url}/${i}`,  // different URLs so dedup does not collapse
          source: "counter",
          timestamp: new Date(`2024-06-0${i + 1}T00:00:00Z`),
          body: JSON.stringify({ value: i * 10 }),
        }),
      ]);
    }

    const items = dbMod.getItemsByPanel("limited-panel", 1);
    expect(items).toHaveLength(1);
    // latest timestamp wins
    expect(items[0].id).toBe("counter:c:4");
  });

  // -- Bookmarks adapter refresh: stable IDs --

  test("bookmarks adapter items with stable IDs overwrite on re-save (no duplicates)", async () => {
    const item = makeContentItem({
      id: "bookmarks:my-link-0",
      title: "My Link",
      url: "https://example.com/link",
      source: "bookmarks",
      timestamp: new Date("2024-06-01T00:00:00Z"),
    });

    // First save
    dbMod.saveItems("bm-panel", [item]);
    let items = dbMod.getItemsByPanel("bm-panel");
    expect(items).toHaveLength(1);

    // Second save (simulates re-fetch with same ID)
    const updated = { ...item, timestamp: new Date("2024-06-02T00:00:00Z") };
    dbMod.saveItems("bm-panel", [updated]);
    items = dbMod.getItemsByPanel("bm-panel");
    expect(items).toHaveLength(1);
    // timestamp updated
    expect(items[0].timestamp).toBe("2024-06-02T00:00:00.000Z");
  });

  // -- Scheduler with bookmarks adapter --

  test("scheduler runs bookmarks adapter, items appear in panel", async () => {
    const items = [
      makeContentItem({
        id: "bookmarks:github-0",
        title: "GitHub",
        url: "https://github.com",
        source: "bookmarks",
      }),
      makeContentItem({
        id: "bookmarks:docs-1",
        title: "Docs",
        url: "https://docs.example.com",
        source: "bookmarks",
      }),
    ];
    const adapters = adaptersMap(["bookmarks", makeMockAdapter(items)]);
    const config = testAppConfig(
      { adapters: [{ type: "bookmarks", name: "links", refresh_interval: 60 }] },
      singlePanelLayout("bookmarks", "links", { id: "bm-p" }),
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();
    const saved = dbMod.getAllItemsByPanel("bm-p");
    expect(saved).toHaveLength(2);
    expect(saved.map((i) => i.title).sort()).toEqual(["Docs", "GitHub"]);
  });

  // -- Scheduler with counter adapter --

  test("scheduler runs counter adapter, items appear in panel", async () => {
    const items = [
      makeContentItem({
        id: "counter:stars:1718000000000",
        title: "Stars",
        url: "https://api.github.com/repos/foo/bar",
        source: "stars",
        body: JSON.stringify({ value: 42000 }),
      }),
    ];
    const adapters = adaptersMap(["counter", makeMockAdapter(items)]);
    const config = testAppConfig(
      { adapters: [{ type: "counter", name: "stars", refresh_interval: 60 }] },
      singlePanelLayout("stats", "stars", { id: "ctr-p" }),
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();
    const saved = dbMod.getAllItemsByPanel("ctr-p");
    expect(saved).toHaveLength(1);
    expect(saved[0].body).toContain("42000");
  });

  // -- Mixed adapters with source: all --

  test("source: all panel sees items from both bookmarks and counter adapters", async () => {
    const bookmarkItem = makeContentItem({
      id: "bookmarks:link-0",
      title: "My Bookmark",
      url: "https://example.com/bm",
      source: "bookmarks",
    });
    const counterItem = makeContentItem({
      id: "counter:hits:9999",
      title: "Page Hits",
      url: "https://api.example.com/hits",
      source: "hits",
      body: JSON.stringify({ value: 500 }),
    });
    const bookmarkAdapter = makeMockAdapter([bookmarkItem]);
    const counterAdapter = makeMockAdapter([counterItem]);
    const adapters = adaptersMap(["bookmarks", bookmarkAdapter], ["counter", counterAdapter]);

    const config = testAppConfig(
      {
        adapters: [
          { type: "bookmarks", name: "links", refresh_interval: 60 },
          { type: "counter", name: "hits", refresh_interval: 60 },
        ],
      },
      // source: all panel + individual panels
      {
        direction: "column",
        panels: [
          { panel: "all", source: "all", id: "all-panel", limit: 50 },
          { panel: "bm", source: "links", id: "bm-p" },
          { panel: "ctr", source: "hits", id: "ctr-p" },
        ],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();

    // Individual panels should have their specific items
    const bmItems = dbMod.getAllItemsByPanel("bm-p");
    expect(bmItems).toHaveLength(1);
    expect(bmItems[0].title).toBe("My Bookmark");

    const ctrItems = dbMod.getAllItemsByPanel("ctr-p");
    expect(ctrItems).toHaveLength(1);
    expect(ctrItems[0].title).toBe("Page Hits");

    // "all" panel uses getRecentItems which reads across panels
    const allItems = dbMod.getRecentItems(50);
    expect(allItems.length).toBeGreaterThanOrEqual(2);
    const titles = allItems.map((i) => i.title);
    expect(titles).toContain("My Bookmark");
    expect(titles).toContain("Page Hits");
  });

  // -- Orphan adapter (adapter with no matching panel) --

  test("adapter with no matching panel uses adapter name as panel ID fallback", async () => {
    // Layout has no panel pointing to "orphan-src", but adapter exists
    const items = [
      makeContentItem({ id: "o1", title: "Orphan", url: "https://orphan.example.com", source: "orphan-src" }),
    ];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    const config = testAppConfig(
      { adapters: [{ type: "test", name: "orphan-src", refresh_interval: 60 }] },
      // panel points to a different source
      singlePanelLayout("news", "other-src", { id: "news-panel" }),
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();

    // Items should be saved under the adapter name as fallback panel ID
    const saved = dbMod.getAllItemsByPanel("orphan-src");
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Orphan");
  });

  // -- Refresh with widget-only layout --

  test("refreshSources returns empty when no adapters are registered (widget-only)", async () => {
    const config = testAppConfig({ adapters: [] });
    const adapters = new Map<string, Adapter>();
    startTestScheduler(config, adapters, emptyPanelMap(), null);
    // Refreshing nonexistent sources
    const results = await refreshTestSources(["bookmarks", "counter"]);
    expect(results).toEqual([]);
  });

  // -- Adapter names not confused with widget discriminators --

  test("adapter named 'image' does not conflict with image widget discriminator", async () => {
    const items = [
      makeContentItem({ id: "img1", title: "Photo", url: "https://photos.example.com/1", source: "image" }),
    ];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    const config = testAppConfig(
      { adapters: [{ type: "test", name: "image", refresh_interval: 60 }] },
      singlePanelLayout("photos", "image", { id: "photo-panel" }),
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();
    const saved = dbMod.getAllItemsByPanel("photo-panel");
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Photo");
  });

  // -- loadDashboardPanelDataMap with counter display mode --

  test("loadDashboardPanelDataMap loads counter panel items correctly", async () => {
    const counterBody = JSON.stringify({ value: 9999, unit: "stars" });
    dbMod.saveItems("stat-panel", [
      makeContentItem({
        id: "counter:gh:1",
        title: "GitHub Stars",
        url: "https://api.github.com/repos/foo/bar",
        source: "gh-stars",
        body: counterBody,
      }),
    ]);

    const dashboardPanels: DashboardPanel[] = [
      {
        panel: { panel: "stats", source: "gh-stars", id: "stat-panel", display: "counter" },
        pid: "stat-panel",
        isAll: false,
      },
    ];
    const panelData = dbMod.loadDashboardPanelDataMap(dashboardPanels);
    const stats = panelData.get("stats");
    expect(stats).toBeDefined();
    expect(stats!.items).toHaveLength(1);
    expect(stats!.items[0].body).toContain("9999");
  });
});
