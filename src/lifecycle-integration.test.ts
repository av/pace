/**
 * End-to-end lifecycle integration tests.
 *
 * Each test exercises the full pipeline:
 *   config -> adapter.fetch -> DB save -> DB load -> panel render -> HTML verify
 *
 * Covers: counter adapter, bookmarks adapter, and counter refresh cycle (trend arrow).
 */
import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import {
  initDb,
  saveItems,
  getItemsByPanel,
  loadDashboardPanelData,
} from "./db";
import { renderDashboard, type PanelData } from "./layout";
import { buildLayoutRuntimeMaps, collectPanels, resolvePanelId } from "./layout/domain";
import { CounterPanel, parseCounterBody } from "./layout/counter-panel";
import counterAdapter from "./adapters/counter";
import bookmarksAdapter from "./adapters/bookmarks";
import type { AdapterConfig } from "./adapters/types";
import { panelCfg, flexCfg } from "./test/layout-cfg";

// Shared DB setup/teardown per test
installTempDbHooks({ prefix: "pace-lifecycle-", init: true, warnOnRmFail: true });

// ---- Section 1: Counter full lifecycle ----

describe("counter adapter full lifecycle", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("config -> fetch -> DB -> panel data -> render -> HTML", async () => {
    // 1. Config: define a counter adapter and a counter display panel
    const adapterConfig: AdapterConfig & { name?: string } = {
      type: "counter",
      name: "github-stars",
      params: {
        url: "https://api.github.com/repos/test/repo",
        json_path: "stargazers_count",
        label: "Stars",
        unit: "stars",
      },
    };

    const panelNode = panelCfg("Metrics", "github-stars", { display: "counter" });
    const layout = flexCfg("row", [panelNode]);
    const panelId = resolvePanelId(panelNode);

    // 2. Adapter fetch: mock HTTP, call adapter
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ stargazers_count: 93200 }), { status: 200 }),
    );

    const items = await counterAdapter.fetch(adapterConfig);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.title).toBe("Stars");

    const bodyParsed = JSON.parse(item.body!);
    expect(bodyParsed.value).toBe(93200);
    expect(bodyParsed.unit).toBe("stars");

    // 3. DB storage: save items under the panel ID
    saveItems(panelId, items);

    // 4. Panel data loading: load from DB using same panel ID
    const snapshot = loadDashboardPanelData(panelId, false, 50);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]!.title).toBe("Stars");
    expect(snapshot.lastRefreshedAt).not.toBeNull();

    // Verify DB round-trip preserved the JSON body
    const dbBody = parseCounterBody(snapshot.items[0]!.body);
    expect(dbBody).not.toBeNull();
    expect(dbBody!.value).toBe(93200);
    expect(dbBody!.unit).toBe("stars");

    // 5. Counter panel rendering
    const panelData = new Map<string, PanelData>([
      ["Metrics", snapshot],
    ]);

    // 6. HTML verification
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("counter-panel");
    expect(html).toContain("stat-card");
    expect(html).toContain("Stars");
    expect(html).toContain("93.2k"); // abbreviateNumber for 93200
    expect(html).toContain("stars"); // unit
    expect(html).toContain('<h2 title="Metrics">Metrics</h2>');
  });
});

// ---- Section 2: Bookmarks full lifecycle ----

describe("bookmarks adapter full lifecycle", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("config -> fetch -> DB -> panel data -> render -> HTML", async () => {
    // 1. Config: bookmarks adapter with items
    const adapterConfig: AdapterConfig = {
      type: "bookmarks",
      params: {
        items: [
          { title: "GitHub", url: "https://github.com", description: "Code hosting", tags: ["dev"] },
          { title: "MDN Docs", url: "https://developer.mozilla.org", description: "Web reference", tags: ["docs"] },
          { title: "Hacker News", url: "https://news.ycombinator.com", tags: ["news"] },
        ],
      },
    };

    const panelNode = panelCfg("Quick Links", "bookmarks");
    const layout = flexCfg("row", [panelNode]);
    const panelId = resolvePanelId(panelNode);

    // 2. Adapter fetch (no HTTP mock needed - bookmarks reads from config)
    const items = await bookmarksAdapter.fetch(adapterConfig);
    expect(items).toHaveLength(3);
    expect(items[0]!.title).toBe("GitHub");
    expect(items[0]!.url).toBe("https://github.com");
    expect(items[0]!.source).toBe("bookmarks:dev"); // first tag used as source suffix

    // 3. DB storage
    saveItems(panelId, items);

    // 4. Panel data loading
    const snapshot = loadDashboardPanelData(panelId, false, 50);
    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.lastRefreshedAt).not.toBeNull();

    // Verify DB preserved titles and URLs
    const titles = snapshot.items.map((i) => i.title).sort();
    expect(titles).toEqual(["GitHub", "Hacker News", "MDN Docs"]);

    // 5. Standard panel rendering (bookmarks use regular panel, not counter)
    const panelData = new Map<string, PanelData>([
      ["Quick Links", snapshot],
    ]);

    // 6. HTML verification: bookmarks render as clickable links
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("panel-body"); // standard panel, not counter-panel
    expect(html).toContain('<h2 title="Quick Links">Quick Links</h2>');

    // All three bookmarks present as clickable links
    expect(html).toContain('href="https://github.com"');
    expect(html).toContain(">GitHub</a>");
    expect(html).toContain('href="https://developer.mozilla.org"');
    expect(html).toContain(">MDN Docs</a>");
    expect(html).toContain('href="https://news.ycombinator.com"');
    expect(html).toContain(">Hacker News</a>");

    // Source pills are present
    expect(html).toContain("item-source");

    // No counter-panel elements
    expect(html).not.toContain("counter-panel");
    expect(html).not.toContain("stat-card");
  });

  test("bookmarks with descriptions are stored and rendered", async () => {
    const adapterConfig: AdapterConfig = {
      type: "bookmarks",
      params: {
        items: [
          { title: "Docs", url: "https://docs.example.com", description: "Internal documentation portal" },
        ],
      },
    };

    const panelNode = panelCfg("Resources", "bookmarks");
    const panelId = resolvePanelId(panelNode);

    const items = await bookmarksAdapter.fetch(adapterConfig);
    expect(items[0]!.body).toBe("Internal documentation portal");

    // Save and reload
    saveItems(panelId, items);
    const snapshot = loadDashboardPanelData(panelId, false, 50);

    // Description is stored in body column
    expect(snapshot.items[0]!.body).toBe("Internal documentation portal");
  });
});

// ---- Section 3: Counter refresh cycle with trend ----

describe("counter refresh cycle with trend arrow", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("first fetch 100, second fetch 150 with compare, renders trend up", async () => {
    const adapterConfig: AdapterConfig & { name?: string } = {
      type: "counter",
      name: "stars",
      params: {
        url: "https://api.example.com/current",
        json_path: "count",
        label: "Stars",
        compare_url: "https://api.example.com/previous",
        compare_path: "count",
      },
    };

    const panelNode = panelCfg("Trend", "stars", { display: "counter" });
    const layout = flexCfg("row", [panelNode]);
    const panelId = resolvePanelId(panelNode);

    // -- First fetch: value is 100, no compare data yet --
    fetchSpy = spyOn(globalThis, "fetch")
      // Main URL
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 100 }), { status: 200 }),
      )
      // Compare URL (historical endpoint returns 80)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 80 }), { status: 200 }),
      );

    const firstItems = await counterAdapter.fetch(adapterConfig);
    expect(firstItems).toHaveLength(1);

    const firstBody = JSON.parse(firstItems[0]!.body!);
    expect(firstBody.value).toBe(100);
    expect(firstBody.previous).toBe(80); // compare yielded 80

    // Save first fetch
    saveItems(panelId, firstItems);

    // Verify DB has 1 item
    const firstSnapshot = loadDashboardPanelData(panelId, false, 50);
    expect(firstSnapshot.items).toHaveLength(1);

    fetchSpy.mockRestore();

    // -- Second fetch: value is 150, compare returns 100 (the old value) --
    fetchSpy = spyOn(globalThis, "fetch")
      // Main URL
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 150 }), { status: 200 }),
      )
      // Compare URL returns 100 as previous
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 100 }), { status: 200 }),
      );

    const secondItems = await counterAdapter.fetch(adapterConfig);
    expect(secondItems).toHaveLength(1);

    const secondBody = JSON.parse(secondItems[0]!.body!);
    expect(secondBody.value).toBe(150);
    expect(secondBody.previous).toBe(100);

    // Save second fetch (new ID since timestamp differs)
    saveItems(panelId, secondItems);

    // Counter items have url="" so dedup groups by id ("counter:stars").
    // Both fetches produce the same id, so only the latest wins.
    const secondSnapshot = loadDashboardPanelData(panelId, false, 50);
    expect(secondSnapshot.items).toHaveLength(1);

    const latestItem = secondSnapshot.items[0]!;
    const latestBody = parseCounterBody(latestItem.body);
    expect(latestBody).not.toBeNull();
    expect(latestBody!.value).toBe(150);
    expect(latestBody!.previous).toBe(100);

    // Render with the latest data
    const panelData = new Map<string, PanelData>([
      ["Trend", { panelId, items: [latestItem], lastRefreshedAt: latestItem.fetched_at }],
    ]);

    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Verify trend arrow: 150 > 100 => up
    expect(html).toContain("stat-trend-up");
    expect(html).toContain("150"); // value displayed
    expect(html).toContain("Stars"); // label
    expect(html).toContain("counter-panel");
    expect(html).toContain("stat-card");
  });

  test("same value on refresh shows no trend arrow", async () => {
    const adapterConfig: AdapterConfig & { name?: string } = {
      type: "counter",
      name: "stable",
      params: {
        url: "https://api.example.com/metric",
        json_path: "value",
        label: "Uptime",
        compare_url: "https://api.example.com/metric-prev",
        compare_path: "value",
      },
    };

    // Both current and compare return same value
    fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 99.9 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 99.9 }), { status: 200 }),
      );

    const items = await counterAdapter.fetch(adapterConfig);
    const body = JSON.parse(items[0]!.body!);
    expect(body.value).toBe(99.9);
    expect(body.previous).toBe(99.9);

    const panelNode = panelCfg("Stable", "stable", { display: "counter" });
    const layout = flexCfg("row", [panelNode]);
    const panelId = resolvePanelId(panelNode);

    saveItems(panelId, items);
    const snapshot = loadDashboardPanelData(panelId, false, 50);

    const panelData = new Map<string, PanelData>([
      ["Stable", snapshot],
    ]);

    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // No trend arrow for flat values (getTrend returns "flat", TrendArrow returns null)
    expect(html).not.toContain("stat-trend-up");
    expect(html).not.toContain("stat-trend-down");
    expect(html).toContain("stat-card");
    expect(html).toContain("99.9");
    expect(html).toContain("Uptime");
  });

  test("decreasing value shows trend down arrow", async () => {
    const adapterConfig: AdapterConfig & { name?: string } = {
      type: "counter",
      name: "errors",
      params: {
        url: "https://api.example.com/errors",
        json_path: "count",
        label: "Errors",
        compare_url: "https://api.example.com/errors-prev",
        compare_path: "count",
      },
    };

    // Current is less than previous
    fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 5 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 20 }), { status: 200 }),
      );

    const items = await counterAdapter.fetch(adapterConfig);
    const body = JSON.parse(items[0]!.body!);
    expect(body.value).toBe(5);
    expect(body.previous).toBe(20);

    const panelNode = panelCfg("Error Rate", "errors", { display: "counter" });
    const layout = flexCfg("row", [panelNode]);
    const panelId = resolvePanelId(panelNode);

    saveItems(panelId, items);
    const snapshot = loadDashboardPanelData(panelId, false, 50);

    const panelData = new Map<string, PanelData>([
      ["Error Rate", snapshot],
    ]);

    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // 5 < 20 => trend down
    expect(html).toContain("stat-trend-down");
    expect(html).not.toContain("stat-trend-up");
    expect(html).toContain("5");
    expect(html).toContain("Errors");
  });
});

// ---- Section 4: Mixed counter + bookmarks in same dashboard ----

describe("mixed counter and bookmarks in one dashboard", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("both adapters coexist, each panel renders its own display mode", async () => {
    // Counter adapter fetch
    const counterConfig: AdapterConfig & { name?: string } = {
      type: "counter",
      name: "downloads",
      params: {
        url: "https://api.example.com/downloads",
        json_path: "total",
        label: "Downloads",
        unit: "total",
      },
    };

    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ total: 1500000 }), { status: 200 }),
    );

    const counterItems = await counterAdapter.fetch(counterConfig);

    // Bookmarks adapter fetch
    const bookmarksConfig: AdapterConfig = {
      type: "bookmarks",
      params: {
        items: [
          { title: "NPM", url: "https://npmjs.com" },
          { title: "PyPI", url: "https://pypi.org" },
        ],
      },
    };

    const bookmarkItems = await bookmarksAdapter.fetch(bookmarksConfig);

    // Layout: counter panel + bookmarks panel side by side
    const counterPanel = panelCfg("Stats", "downloads", { display: "counter" });
    const linksPanel = panelCfg("Package Repos", "bookmarks");
    const layout = flexCfg("row", [counterPanel, linksPanel]);

    const counterPanelId = resolvePanelId(counterPanel);
    const linksPanelId = resolvePanelId(linksPanel);

    // DB storage
    saveItems(counterPanelId, counterItems);
    saveItems(linksPanelId, bookmarkItems);

    // Load panel data
    const counterSnapshot = loadDashboardPanelData(counterPanelId, false, 50);
    const linksSnapshot = loadDashboardPanelData(linksPanelId, false, 50);

    const panelData = new Map<string, PanelData>([
      ["Stats", counterSnapshot],
      ["Package Repos", linksSnapshot],
    ]);

    // Render full dashboard
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });

    // Counter panel section
    expect(html).toContain("counter-panel");
    expect(html).toContain("stat-card");
    expect(html).toContain("1.5M"); // abbreviateNumber for 1500000
    expect(html).toContain("Downloads");
    expect(html).toContain('<h2 title="Stats">Stats</h2>');

    // Bookmarks panel section
    expect(html).toContain("panel-body");
    expect(html).toContain('href="https://npmjs.com"');
    expect(html).toContain(">NPM</a>");
    expect(html).toContain('href="https://pypi.org"');
    expect(html).toContain(">PyPI</a>");
    expect(html).toContain('<h2 title="Package Repos">Package Repos</h2>');

    // Both panels present
    expect(html).toContain("flex-panel");
  });
});

// ---- Section 5: DB dedup behavior with counter URL-based items ----

describe("counter DB dedup on URL", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("multiple fetches with same URL are deduped to latest", async () => {
    const adapterConfig: AdapterConfig & { name?: string } = {
      type: "counter",
      name: "views",
      params: {
        url: "https://api.example.com/views",
        json_path: "count",
        label: "Views",
      },
    };

    const panelNode = panelCfg("Views", "views", { display: "counter" });
    const panelId = resolvePanelId(panelNode);

    // First fetch
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ count: 100 }), { status: 200 }),
    );
    const first = await counterAdapter.fetch(adapterConfig);
    saveItems(panelId, first);
    fetchSpy.mockRestore();

    // Second fetch (different timestamp = different ID, but same URL)
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ count: 200 }), { status: 200 }),
    );
    const second = await counterAdapter.fetch(adapterConfig);
    saveItems(panelId, second);

    // DB dedup: same URL means only the latest is returned
    const snapshot = loadDashboardPanelData(panelId, false, 50);
    expect(snapshot.items).toHaveLength(1);

    const body = parseCounterBody(snapshot.items[0]!.body);
    expect(body!.value).toBe(200); // latest value
  });
});

// ---- Section 6: Bookmarks stable ID upsert ----

describe("bookmarks DB upsert stability", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("re-fetching bookmarks upserts without duplicating", async () => {
    const adapterConfig: AdapterConfig = {
      type: "bookmarks",
      params: {
        items: [
          { title: "Example", url: "https://example.com" },
        ],
      },
    };

    const panelNode = panelCfg("Links", "bookmarks");
    const panelId = resolvePanelId(panelNode);

    // First fetch and save
    const first = await bookmarksAdapter.fetch(adapterConfig);
    saveItems(panelId, first);

    // Second fetch and save (same config, same slugified IDs)
    const second = await bookmarksAdapter.fetch(adapterConfig);
    saveItems(panelId, second);

    // Only 1 item in DB (INSERT ON CONFLICT updates)
    const snapshot = loadDashboardPanelData(panelId, false, 50);
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]!.title).toBe("Example");
  });
});
