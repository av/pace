import { describe, test, expect } from "bun:test";
import { spyConsole, spyMockCallsContaining } from "./test/console-spy";
import { sourcePanelMapFromConfig } from "./test/panel-map";
import { installTempDbHooks } from "./test/temp-db";
import {
  installSchedulerRuntimeHooks,
  refreshTestSources,
  startTestScheduler,
} from "./test/scheduler-test-harness";
import { createSchedulerRuntime } from "./scheduler";
import bookmarksAdapter from "./adapters/bookmarks";
import { adaptersMap, makeMockAdapter } from "./test/adapter-mocks";
import { makeContentItem } from "./test/content-items";
import { testAppConfig, singlePanelLayout, testAppLayout } from "./test/app-config";
import { waitForAsync } from "./test/async";
import * as dbMod from "./db";
import type { AppConfig } from "./config/types";

function bookmarksConfig(items: unknown[], name = "marks"): AppConfig {
  return testAppConfig(
    { adapters: [{ type: "bookmarks", name, refresh_interval: 60, params: { items } }] },
    singlePanelLayout("links", name, { id: "linksPanel", limit: 50 }),
  );
}

const LINEAR = { title: "Linear", url: "https://linear.app" };
const FIGMA = { title: "Figma", url: "https://figma.com" };
const ARXIV = { title: "ArXiv", url: "https://arxiv.org" };

describe("prunePanelItemsByIdPrefix (db)", () => {
  installTempDbHooks({ prefix: "pace-declprune-db-" });

  function seed(rows: { id: string; title?: string }[]): void {
    dbMod.saveItems(
      "p1",
      rows.map((r) =>
        makeContentItem({ id: r.id, title: r.title ?? r.id, url: "https://ex", source: "s" }),
      ),
    );
  }

  test("deletes only prefix-matched rows absent from keepIds; returns count", () => {
    seed([
      { id: "bookmarks:a-0" },
      { id: "bookmarks:b-1" },
      { id: "rss:other" },
      { id: "pipeline:x:bookmarks:a-0" },
    ]);
    const removed = dbMod.prunePanelItemsByIdPrefix(
      "p1",
      "bookmarks:",
      new Set(["bookmarks:a-0"]),
    );
    expect(removed).toBe(1);
    const ids = dbMod.getRawItemsByPanel("p1").map((r) => r.id).sort();
    // rss row and the pipeline COPY (prefix not at position 0) are untouched.
    expect(ids).toEqual(["bookmarks:a-0", "pipeline:x:bookmarks:a-0", "rss:other"]);
  });

  test("prefix matching is positional, not a LIKE pattern (underscore is literal)", () => {
    seed([{ id: "b_okmarks:evil" }, { id: "bookmarks:x-0" }]);
    const removed = dbMod.prunePanelItemsByIdPrefix("p1", "b_okmarks:", new Set());
    expect(removed).toBe(1);
    expect(dbMod.getRawItemsByPanel("p1").map((r) => r.id)).toEqual(["bookmarks:x-0"]);
  });

  test("only the given panel is affected", () => {
    seed([{ id: "bookmarks:a-0" }]);
    dbMod.saveItems("p2", [
      makeContentItem({ id: "bookmarks:a-0", title: "t", url: "https://ex", source: "s" }),
    ]);
    expect(dbMod.prunePanelItemsByIdPrefix("p1", "bookmarks:", new Set())).toBe(1);
    expect(dbMod.getRawItemsByPanel("p2")).toHaveLength(1);
  });

  test("returns 0 and leaves rows alone when nothing is stale", () => {
    seed([{ id: "bookmarks:a-0" }]);
    expect(
      dbMod.prunePanelItemsByIdPrefix("p1", "bookmarks:", new Set(["bookmarks:a-0"])),
    ).toBe(0);
    expect(dbMod.getRawItemsByPanel("p1")).toHaveLength(1);
  });
});

describe("declarative adapter pruning (scheduler)", () => {
  installTempDbHooks({ prefix: "pace-declprune-sched-" });
  installSchedulerRuntimeHooks();

  const adapters = () => adaptersMap(["bookmarks", bookmarksAdapter]);

  test("removing a bookmark from config removes it from the panel on next refresh", async () => {
    const config = bookmarksConfig([LINEAR, FIGMA, ARXIV]);
    await spyConsole(["log"], async () => {
      startTestScheduler(config, adapters(), sourcePanelMapFromConfig(config), null);
      await waitForAsync();
      expect(dbMod.getRawItemsByPanel("linksPanel")).toHaveLength(3);

      // User edits config: ArXiv removed. Entry holds the config reference,
      // so mutate params and refresh (same read path as a fetch).
      (config.adapters[0].params as { items: unknown[] }).items = [LINEAR, FIGMA];
      await refreshTestSources(["marks"]);
      const titles = dbMod.getRawItemsByPanel("linksPanel").map((r) => r.title).sort();
      expect(titles).toEqual(["Figma", "Linear"]);
    });
  });

  test("reordering bookmarks across a restart does not duplicate entries", async () => {
    const first = bookmarksConfig([LINEAR, FIGMA]);
    await spyConsole(["log"], async () => {
      // First app run.
      const runtimeA = createSchedulerRuntime();
      runtimeA.startScheduler(first, adapters(), sourcePanelMapFromConfig(first), null);
      await waitForAsync();
      runtimeA.stopScheduler();
      expect(dbMod.getRawItemsByPanel("linksPanel")).toHaveLength(2);

      // Restart with the two bookmarks swapped: url-hash ids are stable, so
      // the swap upserts the SAME two rows (with legacy index-embedded ids
      // this relied on pruning to drop the stale copies).
      const second = bookmarksConfig([FIGMA, LINEAR]);
      const runtimeB = createSchedulerRuntime();
      runtimeB.startScheduler(second, adapters(), sourcePanelMapFromConfig(second), null);
      await waitForAsync();
      runtimeB.stopScheduler();

      const rows = dbMod.getRawItemsByPanel("linksPanel");
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id).sort()).toEqual([
        "bookmarks:figma-lbc8jg",
        "bookmarks:linear-gb1xpj",
      ]);
    });
  });

  test("clearing the bookmarks list empties the panel (prune runs on empty fetch)", async () => {
    const config = bookmarksConfig([LINEAR]);
    await spyConsole(["log", "warn"], async () => {
      startTestScheduler(config, adapters(), sourcePanelMapFromConfig(config), null);
      await waitForAsync();
      expect(dbMod.getRawItemsByPanel("linksPanel")).toHaveLength(1);

      (config.adapters[0].params as { items: unknown[] }).items = [];
      await refreshTestSources(["marks"]);
      expect(dbMod.getRawItemsByPanel("linksPanel")).toHaveLength(0);
    });
  });

  test("prune leaves other sources' rows on a shared panel intact", async () => {
    const config = testAppConfig(
      {
        adapters: [
          { type: "bookmarks", name: "marks", refresh_interval: 60, params: { items: [LINEAR, FIGMA] } },
          { type: "test", name: "feed", refresh_interval: 60 },
        ],
      },
      {
        direction: "row",
        panels: [
          { panel: "a", source: "marks", id: "shared" },
          { panel: "b", source: "feed", id: "shared" },
        ],
      },
    );
    const feedItems = [
      makeContentItem({ id: "rss:one", title: "Feed One", url: "https://f", source: "feed" }),
    ];
    const all = adaptersMap(["bookmarks", bookmarksAdapter], ["test", makeMockAdapter(feedItems)]);
    await spyConsole(["log"], async () => {
      startTestScheduler(config, all, sourcePanelMapFromConfig(config), null);
      await waitForAsync();
      expect(dbMod.getRawItemsByPanel("shared")).toHaveLength(3);

      (config.adapters[0].params as { items: unknown[] }).items = [LINEAR];
      await refreshTestSources(["marks"]);
      const ids = dbMod.getRawItemsByPanel("shared").map((r) => r.id).sort();
      expect(ids).toEqual(["bookmarks:linear-gb1xpj", "rss:one"]);
    });
  });

  test("two bookmarks sources sharing one panel: pruning disabled with a log, rows coexist", async () => {
    const config = testAppConfig(
      {
        adapters: [
          { type: "bookmarks", name: "work", refresh_interval: 60, params: { items: [LINEAR] } },
          { type: "bookmarks", name: "home", refresh_interval: 60, params: { items: [FIGMA] } },
        ],
      },
      {
        direction: "row",
        panels: [
          { panel: "a", source: "work", id: "shared" },
          { panel: "b", source: "home", id: "shared" },
        ],
      },
    );
    await spyConsole(["log"], async ({ log: logSpy }) => {
      startTestScheduler(config, adapters(), sourcePanelMapFromConfig(config), null);
      await waitForAsync();
      expect(spyMockCallsContaining(logSpy, "stale-item pruning disabled").length).toBe(2);
      // Both sources' rows survive each other's refreshes.
      await refreshTestSources(["work", "home"]);
      const titles = dbMod.getRawItemsByPanel("shared").map((r) => r.title).sort();
      expect(titles).toEqual(["Figma", "Linear"]);
    });
  });

  test("non-declarative adapters keep cached rows when a later fetch shrinks", async () => {
    const items = [
      makeContentItem({ id: "rss:one", title: "One", url: "https://a", source: "feed" }),
      makeContentItem({ id: "rss:two", title: "Two", url: "https://b", source: "feed" }),
    ];
    const mock = makeMockAdapter(items);
    const config = testAppConfig(
      { adapters: [{ type: "test", name: "feed", refresh_interval: 60 }] },
      singlePanelLayout("p", "feed", { id: "feedPanel" }),
    );
    await spyConsole(["log"], async () => {
      startTestScheduler(config, adaptersMap(["test", mock]), sourcePanelMapFromConfig(config), null);
      await waitForAsync();
      items.length = 1; // upstream now returns only one item
      await refreshTestSources(["feed"]);
      expect(dbMod.getRawItemsByPanel("feedPanel")).toHaveLength(2);
    });
  });

  test("bookmark timestamps are NOT re-stamped to now on refresh", async () => {
    const config = bookmarksConfig([LINEAR, FIGMA]);
    await spyConsole(["log"], async () => {
      startTestScheduler(config, adapters(), sourcePanelMapFromConfig(config), null);
      await waitForAsync();
      const before = new Map(
        dbMod.getRawItemsByPanel("linksPanel").map((r) => [r.id, r.timestamp]),
      );
      expect(before.size).toBe(2);

      // Backdate stored timestamps to simulate an aged panel, then refresh:
      // the adapter fabricates fresh now-based timestamps every fetch, but
      // the declarative save must keep the stored (first-seen) ones.
      const aged = "2026-01-01T00:00:00.000Z";
      dbMod
        .getDb()
        .prepare("UPDATE content_items SET timestamp = ? WHERE panel_id = 'linksPanel'")
        .run(aged);
      await refreshTestSources(["marks"]);

      const rows = dbMod.getRawItemsByPanel("linksPanel");
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.timestamp).toBe(aged);
    });
  });

  test("summaries survive a config reorder across restart (stable url-hash ids)", async () => {
    const first = bookmarksConfig([LINEAR, FIGMA]);
    await spyConsole(["log"], async () => {
      const runtimeA = createSchedulerRuntime();
      runtimeA.startScheduler(first, adapters(), sourcePanelMapFromConfig(first), null);
      await waitForAsync();
      runtimeA.stopScheduler();

      // An LLM transform stored a summary against the Linear row.
      dbMod
        .getDb()
        .prepare("UPDATE content_items SET summary = ? WHERE id = ?")
        .run("Issue tracker for teams", "bookmarks:linear-gb1xpj");

      // Restart with the bookmarks reordered: ids are unchanged, so the
      // upsert hits the same row and the summary is retained (index-embedded
      // ids would have pruned the row and re-inserted it summary-less).
      const second = bookmarksConfig([FIGMA, LINEAR]);
      const runtimeB = createSchedulerRuntime();
      runtimeB.startScheduler(second, adapters(), sourcePanelMapFromConfig(second), null);
      await waitForAsync();
      runtimeB.stopScheduler();

      const rows = dbMod.getRawItemsByPanel("linksPanel");
      expect(rows).toHaveLength(2);
      const linear = rows.find((r) => r.id === "bookmarks:linear-gb1xpj");
      expect(linear?.summary).toBe("Issue tracker for teams");
    });
  });
});

describe("saveItems preserveStoredTimestamps (db)", () => {
  installTempDbHooks({ prefix: "pace-preserve-ts-" });

  const item = (timestamp: string) =>
    makeContentItem({
      id: "bookmarks:x-abc",
      title: "X",
      url: "https://x",
      source: "s",
      timestamp: new Date(timestamp),
    });

  test("update keeps the stored timestamp; other fields still refresh", () => {
    dbMod.saveItems("p1", [item("2026-01-01T00:00:00.000Z")]);
    dbMod.saveItems(
      "p1",
      [
        makeContentItem({
          id: "bookmarks:x-abc",
          title: "X2",
          url: "https://x",
          source: "s",
          timestamp: new Date("2026-06-01T00:00:00.000Z"),
        }),
      ],
      { preserveStoredTimestamps: true },
    );
    const [row] = dbMod.getRawItemsByPanel("p1");
    expect(row.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(row.title).toBe("X2");
  });

  test("without the option the incoming timestamp overwrites (default unchanged)", () => {
    dbMod.saveItems("p1", [item("2026-01-01T00:00:00.000Z")]);
    dbMod.saveItems("p1", [item("2026-06-01T00:00:00.000Z")]);
    const [row] = dbMod.getRawItemsByPanel("p1");
    expect(row.timestamp).toBe("2026-06-01T00:00:00.000Z");
  });

  test("new rows still get the incoming timestamp under the option", () => {
    dbMod.saveItems("p1", [item("2026-01-01T00:00:00.000Z")], { preserveStoredTimestamps: true });
    const [row] = dbMod.getRawItemsByPanel("p1");
    expect(row.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});
