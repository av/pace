import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HELP_ROWS,
  KEY_MOVES,
  isTypingTarget,
  itemMatchesFilter,
  keyMove,
  moveIndex,
  parseFilterQuery,
  searchFeedUrl,
  shouldIgnoreKeydown,
  COLLAPSE_STORAGE_KEY,
  parseStoredPanelIds,
  togglePanelId,
  collapseAllTarget,
  THEME_STORAGE_KEY,
  parseStoredTheme,
  nextTheme,
  parseStoredThemeChoice,
  resolveTheme,
  THEME_COLORS,
  themeColorFor,
  SEEN_CLASS,
  autoSeenItem,
  panelSeenTarget,
  parseSeenKeys,
  HIDE_SEEN_CLASS,
  HIDE_SEEN_STORAGE_KEY,
  parseStoredHideSeen,
  COLLAPSE_BTN_CLASS,
  PANEL_SEEN_BTN_CLASS,
  ITEM_SEEN_BTN_CLASS,
  collapseButtonLabel,
  itemSeenButtonLabel,
  panelSeenButtonLabel,
  TOOLBAR_CLASS,
  THEME_BTN_CLASS,
  HIDE_SEEN_BTN_CLASS,
  FILTER_BTN_CLASS,
  HELP_BTN_CLASS,
  themeButtonLabel,
  hideSeenButtonLabel,
  hideSeenDefaultOn,
  initialHideSeen,
  HIDDEN_COUNT_CLASS,
  hiddenCountBadge,
  UNSEEN_COUNT_CLASS,
  pageTitleWithUnread,
  faviconHref,
  faviconSvg,
  unseenCountBadge,
} from "./dashboard.js";
import { itemSeenKey } from "./db";
import { renderDashboard, type PanelData } from "./layout";
import { normalizeBasePath } from "./config/domain";
import { installTempDbHooks } from "./test/temp-db";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import {
  createTestServerApp,
  expectSecurityHeaders,
  makeServerRouteDeps,
  requestServerRoute,
} from "./test/server-harness";

installTempDbHooks({ prefix: "pace-dashboard-kbd-" });

/* ------------------------------------------------------------------ */
/* Pure helpers (imported straight from the served client module)      */
/* ------------------------------------------------------------------ */

describe("moveIndex", () => {
  test("returns -1 when there is nothing to focus", () => {
    expect(moveIndex(-1, 1, 0)).toBe(-1);
    expect(moveIndex(2, -1, 0)).toBe(-1);
    expect(moveIndex(0, 1, -1)).toBe(-1);
  });

  test("entering from nowhere goes to first (forward) or last (backward)", () => {
    expect(moveIndex(-1, 1, 5)).toBe(0);
    expect(moveIndex(-1, -1, 5)).toBe(4);
  });

  test("moves by delta within bounds", () => {
    expect(moveIndex(1, 1, 5)).toBe(2);
    expect(moveIndex(3, -1, 5)).toBe(2);
  });

  test("clamps at both edges instead of wrapping", () => {
    expect(moveIndex(4, 1, 5)).toBe(4);
    expect(moveIndex(0, -1, 5)).toBe(0);
  });
});

describe("isTypingTarget", () => {
  test("recognizes text-entry elements regardless of tagName case", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "Select" })).toBe(true);
  });

  test("recognizes contenteditable regions", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  test("plain elements and missing targets are not typing targets", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget({ tagName: "A", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

describe("shouldIgnoreKeydown", () => {
  const plain = { tagName: "BODY" };

  test("ignores already-handled and modified keystrokes", () => {
    expect(shouldIgnoreKeydown({ defaultPrevented: true, target: plain })).toBe(true);
    expect(shouldIgnoreKeydown({ ctrlKey: true, target: plain })).toBe(true);
    expect(shouldIgnoreKeydown({ metaKey: true, target: plain })).toBe(true);
    expect(shouldIgnoreKeydown({ altKey: true, target: plain })).toBe(true);
  });

  test("ignores keystrokes while typing in an input", () => {
    expect(shouldIgnoreKeydown({ target: { tagName: "INPUT" } })).toBe(true);
    expect(shouldIgnoreKeydown({ target: { tagName: "DIV", isContentEditable: true } })).toBe(true);
  });

  test("handles unmodified keystrokes on non-typing targets", () => {
    expect(shouldIgnoreKeydown({ target: plain })).toBe(false);
  });
});

describe("keyMove", () => {
  test("j/ArrowDown and k/ArrowUp move items forward and backward", () => {
    for (const key of ["j", "ArrowDown"]) {
      expect(keyMove(key)).toEqual({ axis: "item", delta: 1 });
    }
    for (const key of ["k", "ArrowUp"]) {
      expect(keyMove(key)).toEqual({ axis: "item", delta: -1 });
    }
  });

  test("h/ArrowLeft and l/ArrowRight move panels backward and forward", () => {
    for (const key of ["l", "ArrowRight"]) {
      expect(keyMove(key)).toEqual({ axis: "panel", delta: 1 });
    }
    for (const key of ["h", "ArrowLeft"]) {
      expect(keyMove(key)).toEqual({ axis: "panel", delta: -1 });
    }
  });

  test("unknown keys and Object.prototype keys do not match", () => {
    expect(keyMove("x")).toBeNull();
    expect(keyMove("Enter")).toBeNull();
    expect(keyMove("constructor")).toBeNull();
    expect(keyMove("hasOwnProperty")).toBeNull();
    expect(keyMove("__proto__")).toBeNull();
  });

  test("every KEY_MOVES entry resolves through keyMove", () => {
    for (const key of Object.keys(KEY_MOVES)) {
      expect(keyMove(key)).toBe(KEY_MOVES[key as keyof typeof KEY_MOVES]);
    }
  });
});

describe("parseFilterQuery", () => {
  test("splits on whitespace and lowercases", () => {
    expect(parseFilterQuery("Rust WASM")).toEqual(["rust", "wasm"]);
    expect(parseFilterQuery("  llama\t cpp \n")).toEqual(["llama", "cpp"]);
  });

  test("empty or non-string input yields no terms", () => {
    expect(parseFilterQuery("")).toEqual([]);
    expect(parseFilterQuery("   ")).toEqual([]);
    expect(parseFilterQuery(undefined)).toEqual([]);
    expect(parseFilterQuery(null)).toEqual([]);
    expect(parseFilterQuery(42)).toEqual([]);
  });
});

describe("itemMatchesFilter", () => {
  test("no terms matches everything (clearing the input restores all items)", () => {
    expect(itemMatchesFilter([], "anything")).toBe(true);
    expect(itemMatchesFilter([], "")).toBe(true);
  });

  test("all terms must appear, case-insensitively (AND semantics)", () => {
    const text = "Show HN: A Rust-based WASM runtime";
    expect(itemMatchesFilter(["rust", "wasm"], text)).toBe(true);
    expect(itemMatchesFilter(["rust", "python"], text)).toBe(false);
    expect(itemMatchesFilter(["RUST"], text.toLowerCase())).toBe(true);
  });

  test("missing or non-string text never matches a non-empty query", () => {
    expect(itemMatchesFilter(["rust"], undefined)).toBe(false);
    expect(itemMatchesFilter(["rust"], null)).toBe(false);
  });

  test("searchFeedUrl builds a /api/search.rss link from the query terms", () => {
    expect(searchFeedUrl("", "Rust WASM")).toBe("/api/search.rss?q=rust%20wasm");
    expect(searchFeedUrl("/pace", "  llama\t cpp \n")).toBe(
      "/pace/api/search.rss?q=llama%20cpp",
    );
    // Terms are normalized like the filter bar, so the feed searches exactly
    // what the bar shows; characters meaningful in URLs are escaped.
    expect(searchFeedUrl("", "c++ & rust?")).toBe(
      "/api/search.rss?q=c%2B%2B%20%26%20rust%3F",
    );
  });

  test("searchFeedUrl yields null for empty queries and non-string bases", () => {
    for (const raw of ["", "   ", undefined, null, 42]) {
      expect(searchFeedUrl("", raw)).toBeNull();
    }
    expect(searchFeedUrl(undefined, "rust")).toBeNull();
    expect(searchFeedUrl(null, "rust")).toBeNull();
  });

  test("round-trips with parseFilterQuery", () => {
    expect(itemMatchesFilter(parseFilterQuery("GPU cluster"), "New GPU cluster benchmarks")).toBe(true);
    expect(itemMatchesFilter(parseFilterQuery("GPU cluster"), "CPU cluster benchmarks")).toBe(false);
  });
});

describe("parseStoredPanelIds", () => {
  test("parses a JSON array of non-empty strings", () => {
    expect(parseStoredPanelIds('["news","github"]')).toEqual(["news", "github"]);
  });

  test("drops non-string and empty entries", () => {
    expect(parseStoredPanelIds('["news",42,null,"",["x"],"dev"]')).toEqual(["news", "dev"]);
  });

  test("malformed JSON, non-arrays, and non-strings yield no ids", () => {
    expect(parseStoredPanelIds("not json")).toEqual([]);
    expect(parseStoredPanelIds('{"a":1}')).toEqual([]);
    expect(parseStoredPanelIds('"news"')).toEqual([]);
    expect(parseStoredPanelIds("")).toEqual([]);
    expect(parseStoredPanelIds(null)).toEqual([]);
    expect(parseStoredPanelIds(undefined)).toEqual([]);
    expect(parseStoredPanelIds(42)).toEqual([]);
  });
});

describe("togglePanelId", () => {
  test("adds an absent id and removes a present one", () => {
    expect(togglePanelId([], "news")).toEqual(["news"]);
    expect(togglePanelId(["news"], "dev")).toEqual(["news", "dev"]);
    expect(togglePanelId(["news", "dev"], "news")).toEqual(["dev"]);
  });

  test("does not mutate the input list", () => {
    const ids = ["news"];
    togglePanelId(ids, "dev");
    togglePanelId(ids, "news");
    expect(ids).toEqual(["news"]);
  });

  test("invalid ids leave the (sanitized) list unchanged", () => {
    expect(togglePanelId(["news"], "")).toEqual(["news"]);
    expect(togglePanelId(["news"], undefined)).toEqual(["news"]);
    expect(togglePanelId(["news", 42, ""], null)).toEqual(["news"]);
  });

  test("non-array input is treated as an empty list", () => {
    expect(togglePanelId(undefined, "news")).toEqual(["news"]);
    expect(togglePanelId("junk", "news")).toEqual(["news"]);
  });

  test("round-trips with parseStoredPanelIds through JSON", () => {
    const stored = JSON.stringify(togglePanelId(togglePanelId([], "a"), "b"));
    expect(parseStoredPanelIds(stored)).toEqual(["a", "b"]);
  });
});

describe("collapseAllTarget", () => {
  test("collapses everything unless every panel already is, then expands", () => {
    expect(collapseAllTarget([false, false])).toBe(true);
    expect(collapseAllTarget([true, false])).toBe(true);
    expect(collapseAllTarget([true, true])).toBe(false);
    expect(collapseAllTarget([true])).toBe(false);
  });

  test("treats empty/invalid input as a no-op (false)", () => {
    for (const flags of [[], null, undefined, "junk"]) {
      expect(collapseAllTarget(flags)).toBe(false);
    }
    // Non-boolean entries are not "collapsed", so a mixed list still collapses.
    expect(collapseAllTarget([1, "yes"])).toBe(true);
  });
});

describe("COLLAPSE_STORAGE_KEY", () => {
  test("is a stable, namespaced localStorage key", () => {
    expect(COLLAPSE_STORAGE_KEY).toBe("pace.collapsed-panels");
  });
});

describe("THEME_STORAGE_KEY", () => {
  test("is a stable, namespaced localStorage key", () => {
    expect(THEME_STORAGE_KEY).toBe("pace.theme");
  });
});

describe("parseStoredTheme", () => {
  test("accepts the literal string light", () => {
    expect(parseStoredTheme("light")).toBe("light");
  });

  test("anything else means the dark default", () => {
    for (const raw of ["dark", "LIGHT", "", null, undefined, 42, {}, ["light"]]) {
      expect(parseStoredTheme(raw)).toBe("dark");
    }
  });
});

describe("nextTheme", () => {
  test("flips dark to light and back", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });

  test("untrusted current values count as dark, so the toggle goes light", () => {
    for (const raw of [null, undefined, "", "solarized"]) {
      expect(nextTheme(raw)).toBe("light");
    }
  });
});

describe("parseStoredThemeChoice", () => {
  test("accepts the literal explicit choices", () => {
    expect(parseStoredThemeChoice("light")).toBe("light");
    expect(parseStoredThemeChoice("dark")).toBe("dark");
  });

  test("anything else means no choice was made (null)", () => {
    for (const raw of ["LIGHT", "Dark", "", null, undefined, 42, {}, ["light"]]) {
      expect(parseStoredThemeChoice(raw)).toBe(null);
    }
  });
});

describe("resolveTheme", () => {
  test("an explicit stored choice wins over the OS preference", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  test("without a stored choice the OS preference decides", () => {
    for (const raw of [null, undefined, "", "solarized"]) {
      expect(resolveTheme(raw, true)).toBe("light");
      expect(resolveTheme(raw, false)).toBe("dark");
    }
  });
});

describe("themeColorFor", () => {
  test("maps each theme to its browser-chrome color", () => {
    expect(themeColorFor("dark")).toBe(THEME_COLORS.dark);
    expect(themeColorFor("light")).toBe(THEME_COLORS.light);
  });

  test("unknown values collapse to the dark default", () => {
    for (const raw of [null, undefined, "", "solarized"]) {
      expect(themeColorFor(raw)).toBe(THEME_COLORS.dark);
    }
  });
});

describe("HELP_ROWS", () => {
  test("documents every advertised shortcut", () => {
    const keys = HELP_ROWS.map(([k]) => k).join(" ");
    for (const fragment of ["j / k", "h / l", "Tab", "Enter", "r", "c", "C", "t", "x", "a", "X", "/", "?", "Esc"]) {
      expect(keys).toContain(fragment);
    }
    for (const [, description] of HELP_ROWS) {
      expect(description.length).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Script tag rendering                                                */
/* ------------------------------------------------------------------ */

function renderModeDashboard(mode: "interactive" | "static", basePath = ""): string {
  const layout = flexCfg("row", [panelCfg("Feed", "rss")]);
  const item = makeItem({ title: "Story", source: "rss" });
  const panelData = new Map<string, PanelData>([["Feed", { items: [item] }]]);
  return renderDashboard({ layout, panelData, updatedAt: "now", mode, basePath });
}

describe("dashboard keyboard script tag", () => {
  test("interactive dashboards load /dashboard.js as a module", () => {
    const html = renderModeDashboard("interactive");
    expect(html).toContain('<script type="module" src="/dashboard.js">');
  });

  test("base path prefixes the script src", () => {
    const html = renderModeDashboard("interactive", normalizeBasePath("pace"));
    expect(html).toContain('<script type="module" src="/pace/dashboard.js">');
  });

  test("static exports carry no script at all", () => {
    const html = renderModeDashboard("static");
    expect(html).not.toContain("dashboard.js");
    expect(html).not.toContain("<script");
  });
});

describe("panel collapse markup", () => {
  test("panels carry a data-panel-id for the persisted collapse state", () => {
    const html = renderModeDashboard("interactive");
    const attr = html.match(/class="panel" data-panel-id="([^"]+)"/);
    expect(attr).not.toBeNull();
    // The attribute carries the same resolved panel id the refresh route uses.
    const refresh = html.match(/action="\/refresh\/([^"]+)"/);
    expect(attr![1]).toBe(refresh![1]!);
  });

  test("no panel is server-rendered collapsed (collapse is client state only)", () => {
    for (const mode of ["interactive", "static"] as const) {
      expect(renderModeDashboard(mode)).not.toContain("panel-collapsed");
    }
  });
});

describe("seen item markup and helpers", () => {
  test("items carry a data-seen-key with the item's dedup identity", () => {
    const item = makeItem({ title: "Story", source: "rss", url: "https://Ex.com/Story/" });
    const panelData = new Map<string, PanelData>([["Feed", { items: [item] }]]);
    const layout = flexCfg("row", [panelCfg("Feed", "rss")]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now", mode: "interactive" });
    expect(html).toContain(`data-seen-key="${itemSeenKey(item)}"`);
    expect(html).toContain('data-seen-key="https://ex.com/story"');
  });

  test("no item is server-rendered seen (seen dimming is client state only)", () => {
    for (const mode of ["interactive", "static"] as const) {
      expect(renderModeDashboard(mode)).not.toContain(SEEN_CLASS);
    }
  });

  test("parseSeenKeys keeps only non-empty string keys from a trusted-shape body", () => {
    expect(parseSeenKeys({ keys: ["a", "", 7, "b", null] })).toEqual(["a", "b"]);
    expect(parseSeenKeys({ count: 0, keys: [] })).toEqual([]);
  });

  test("parseSeenKeys tolerates garbage payloads", () => {
    for (const body of [null, undefined, "x", 42, [], { keys: "a" }, {}]) {
      expect(parseSeenKeys(body)).toEqual([]);
    }
  });

  // Minimal element stubs for autoSeenItem: a target whose closest() finds a
  // title link, whose closest() in turn finds (or not) a seen-keyed item.
  function fakeItem(seen: boolean) {
    return { classList: { contains: (cls: string) => cls === SEEN_CLASS && seen } };
  }
  function fakeActivationTarget(link: object | null) {
    return { closest: (sel: string) => (sel === ".item-title a" ? link : null) };
  }
  function fakeTitleLink(item: object | null) {
    return { closest: (sel: string) => (sel === ".item[data-seen-key]" ? item : null) };
  }

  test("autoSeenItem returns the unseen keyed item behind an activated title link", () => {
    const item = fakeItem(false);
    expect(autoSeenItem(fakeActivationTarget(fakeTitleLink(item)))).toBe(item);
  });

  test("autoSeenItem never re-marks an already-seen item (open doesn't toggle back)", () => {
    expect(autoSeenItem(fakeActivationTarget(fakeTitleLink(fakeItem(true))))).toBeNull();
  });

  test("autoSeenItem ignores activations outside item title links", () => {
    expect(autoSeenItem(fakeActivationTarget(null))).toBeNull(); // not a title link
    expect(autoSeenItem(fakeActivationTarget(fakeTitleLink(null)))).toBeNull(); // link w/o keyed item
  });

  test("autoSeenItem tolerates non-element targets", () => {
    for (const target of [null, undefined, "a", 42, {}, { closest: "x" }]) {
      expect(autoSeenItem(target)).toBeNull();
    }
  });

  test("panelSeenTarget marks the panel seen unless every item already is", () => {
    expect(panelSeenTarget([false, false])).toBe(true);
    expect(panelSeenTarget([true, false])).toBe(true);
    expect(panelSeenTarget([true, true])).toBe(false);
    expect(panelSeenTarget([true])).toBe(false);
  });

  test("panelSeenTarget treats empty/invalid input as a no-op (false)", () => {
    for (const flags of [[], null, undefined, "x", 42]) {
      expect(panelSeenTarget(flags)).toBe(false);
    }
  });

  test("HELP_ROWS documents that opening an item marks it seen", () => {
    const row = HELP_ROWS.find(([keys]) => keys === "Enter");
    expect(row).toBeDefined();
    expect(row![1].toLowerCase()).toContain("open");
    expect(row![1].toLowerCase()).toContain("seen");
  });

  test("HELP_ROWS documents the whole-panel seen shortcut a", () => {
    const row = HELP_ROWS.find(([keys]) => keys === "a");
    expect(row).toBeDefined();
    expect(row![1].toLowerCase()).toContain("panel");
    expect(row![1].toLowerCase()).toContain("seen");
  });
});

describe("hide-seen mode helpers", () => {
  test("HIDE_SEEN_STORAGE_KEY is a stable, namespaced localStorage key", () => {
    expect(HIDE_SEEN_STORAGE_KEY).toBe("pace.hide-seen");
  });

  test("HELP_ROWS documents the collapse-all Shift+C shortcut", () => {
    const row = HELP_ROWS.find(([keys]) => keys === "C");
    expect(row).toBeDefined();
    expect(row?.[1].toLowerCase()).toContain("all panels");
  });

  test("HELP_ROWS documents the hide-seen Shift+X shortcut", () => {
    const row = HELP_ROWS.find(([keys]) => keys === "X");
    expect(row).toBeDefined();
    expect(row![1].toLowerCase()).toContain("seen");
  });

  test("parseStoredHideSeen accepts only the literal string 1", () => {
    expect(parseStoredHideSeen("1")).toBe(true);
    for (const raw of ["0", "true", "", null, undefined, 1, {}, ["1"]]) {
      expect(parseStoredHideSeen(raw)).toBe(false);
    }
  });

  test("hide-seen is client state only: the server never renders its classes", () => {
    for (const mode of ["interactive", "static"] as const) {
      const html = renderModeDashboard(mode);
      expect(html).not.toContain(HIDE_SEEN_CLASS);
      expect(html).not.toContain("all-seen");
    }
  });

  test("hideSeenDefaultOn reads exactly the server-stamped body attribute", () => {
    const bodyOn = { getAttribute: (n: string) => (n === "data-hide-seen" ? "on" : null) };
    const bodyOther = { getAttribute: (n: string) => (n === "data-hide-seen" ? "off" : null) };
    const bodyBare = { getAttribute: () => null };
    expect(hideSeenDefaultOn(bodyOn)).toBe(true);
    expect(hideSeenDefaultOn(bodyOther)).toBe(false);
    expect(hideSeenDefaultOn(bodyBare)).toBe(false);
    expect(hideSeenDefaultOn(null)).toBe(false);
    expect(hideSeenDefaultOn(undefined)).toBe(false);
  });

  test("initialHideSeen: a stored choice always beats the config default", () => {
    const bodyOn = { getAttribute: (n: string) => (n === "data-hide-seen" ? "on" : null) };
    const bodyBare = { getAttribute: () => null };
    // Explicit choices win in both directions.
    expect(initialHideSeen("1", bodyBare)).toBe(true);
    expect(initialHideSeen("0", bodyOn)).toBe(false);
    // No stored choice: the config stamp decides.
    expect(initialHideSeen(null, bodyOn)).toBe(true);
    expect(initialHideSeen(null, bodyBare)).toBe(false);
    // Garbage storage values fall back to the default too.
    for (const raw of ["true", "", undefined, 1, {}]) {
      expect(initialHideSeen(raw, bodyOn)).toBe(true);
      expect(initialHideSeen(raw, bodyBare)).toBe(false);
    }
  });

  test("static exports never carry hide-seen stamps (body default or panel override)", () => {
    const layout = flexCfg("row", [panelCfg("Feed", "rss", { hide_seen: true })]);
    const item = makeItem({ title: "Story", source: "rss" });
    const panelData = new Map<string, PanelData>([["Feed", { items: [item] }]]);
    const staticHtml = renderDashboard({ layout, panelData, updatedAt: "now", mode: "static", hideSeenDefault: true });
    expect(staticHtml).not.toContain("data-hide-seen");
    const interactiveHtml = renderDashboard({ layout, panelData, updatedAt: "now", hideSeenDefault: true });
    expect(interactiveHtml).toContain('data-hide-seen="on"');
  });
});

describe("hide-seen CSS overrides", () => {
  test("panel hide_seen overrides carve into the display:none rule in both directions", () => {
    // "off" panels are exempt while the page-wide mode is on.
    expect(STYLES).toContain('html.hide-seen .panel:not([data-hide-seen="off"]) .item.item-seen');
    // "on" panels hide their seen items even while the mode is off.
    expect(STYLES).toContain('.panel[data-hide-seen="on"] .item.item-seen');
    // ...and dim like caught-up panels do under the page-wide mode.
    expect(STYLES).toContain('.panel[data-hide-seen="on"].all-seen');
  });
});

describe("mouse affordance helpers", () => {
  test("button classes are stable and distinct from server-rendered classes", () => {
    expect(COLLAPSE_BTN_CLASS).toBe("collapse-btn");
    expect(PANEL_SEEN_BTN_CLASS).toBe("panel-seen-btn");
    expect(ITEM_SEEN_BTN_CLASS).toBe("item-seen-btn");
  });

  test("collapseButtonLabel names the action about to happen", () => {
    expect(collapseButtonLabel("News", false)).toBe("Collapse News");
    expect(collapseButtonLabel("News", true)).toBe("Expand News");
  });

  test("collapseButtonLabel falls back to 'panel' for missing titles", () => {
    for (const title of ["", null, undefined, 42]) {
      expect(collapseButtonLabel(title, false)).toBe("Collapse panel");
    }
  });

  test("itemSeenButtonLabel flips with the item's current seen state", () => {
    expect(itemSeenButtonLabel(false)).toBe("Mark item seen");
    expect(itemSeenButtonLabel(true)).toBe("Mark item unseen");
    // Untrusted state (attribute round-trips) only counts literal true.
    expect(itemSeenButtonLabel("true")).toBe("Mark item seen");
    expect(itemSeenButtonLabel(undefined)).toBe("Mark item seen");
  });

  test("panelSeenButtonLabel names the panel and falls back to 'panel'", () => {
    expect(panelSeenButtonLabel("News")).toBe("Mark all in News seen / unseen");
    expect(panelSeenButtonLabel("")).toBe("Mark all in panel seen / unseen");
  });

  test("mouse affordance buttons are client-injected: the server never renders them", () => {
    for (const mode of ["interactive", "static"] as const) {
      const html = renderModeDashboard(mode);
      expect(html).not.toContain(COLLAPSE_BTN_CLASS);
      expect(html).not.toContain(PANEL_SEEN_BTN_CLASS);
      expect(html).not.toContain(ITEM_SEEN_BTN_CLASS);
      // The filter bar (and its subscribe link) is client-injected too.
      expect(html).not.toContain("item-filter");
    }
  });
});

describe("top-corner toolbar helpers", () => {
  test("toolbar and button classes are stable and distinct from server-rendered classes", () => {
    expect(TOOLBAR_CLASS).toBe("page-toolbar");
    expect(THEME_BTN_CLASS).toBe("theme-btn");
    expect(HIDE_SEEN_BTN_CLASS).toBe("hide-seen-btn");
    expect(HELP_BTN_CLASS).toBe("help-btn");
    expect(FILTER_BTN_CLASS).toBe("filter-btn");
    // Each toolbar button has its own class so styling and tests can target
    // one without hitting another.
    const classes = [THEME_BTN_CLASS, HIDE_SEEN_BTN_CLASS, FILTER_BTN_CLASS, HELP_BTN_CLASS];
    expect(new Set(classes).size).toBe(classes.length);
  });

  test("themeButtonLabel names the theme a click will switch to", () => {
    expect(themeButtonLabel("dark")).toBe("Switch to light theme");
    expect(themeButtonLabel("light")).toBe("Switch to dark theme");
    // Untrusted state: anything but the literal "light" counts as dark,
    // matching parseStoredTheme.
    expect(themeButtonLabel(undefined)).toBe("Switch to light theme");
    expect(themeButtonLabel("LIGHT")).toBe("Switch to light theme");
  });

  test("hideSeenButtonLabel flips with the current hide-seen mode", () => {
    expect(hideSeenButtonLabel(false)).toBe("Hide seen items");
    expect(hideSeenButtonLabel(true)).toBe("Show seen items");
    // Untrusted state only counts literal true.
    expect(hideSeenButtonLabel("true")).toBe("Hide seen items");
    expect(hideSeenButtonLabel(undefined)).toBe("Hide seen items");
  });

  test("hideSeenButtonLabel carries the hidden count while hiding", () => {
    expect(hideSeenButtonLabel(true, 12)).toBe("Show seen items (12 hidden)");
    expect(hideSeenButtonLabel(true, 0)).toBe("Show seen items");
    // Off-mode labels never mention a count, whatever is passed.
    expect(hideSeenButtonLabel(false, 12)).toBe("Hide seen items");
  });

  test("hiddenCountBadge renders only positive integer counts while hiding", () => {
    expect(HIDDEN_COUNT_CLASS).toBe("hidden-count");
    expect(hiddenCountBadge(true, 3)).toBe("3");
    expect(hiddenCountBadge(true, 0)).toBe("");
    expect(hiddenCountBadge(false, 3)).toBe("");
    // Untrusted counts: non-numbers, negatives, and non-integers collapse.
    expect(hiddenCountBadge(true, -1)).toBe("");
    expect(hiddenCountBadge(true, 2.5)).toBe("");
    expect(hiddenCountBadge(true, "3")).toBe("");
    expect(hiddenCountBadge(true, NaN)).toBe("");
  });

  test("unseenCountBadge renders only positive unread counts from sane inputs", () => {
    expect(UNSEEN_COUNT_CLASS).toBe("unseen-count");
    expect(unseenCountBadge(5, 2)).toBe("3");
    expect(unseenCountBadge(5, 0)).toBe("5");
    // Fully-read panels (and panels with no seen-keyed items) collapse.
    expect(unseenCountBadge(5, 5)).toBe("");
    expect(unseenCountBadge(0, 0)).toBe("");
    // Untrusted DOM-derived counts: non-numbers, negatives, non-integers,
    // and seen > total all collapse rather than rendering nonsense.
    expect(unseenCountBadge("5", 2)).toBe("");
    expect(unseenCountBadge(5, "2")).toBe("");
    expect(unseenCountBadge(-1, 0)).toBe("");
    expect(unseenCountBadge(5, -1)).toBe("");
    expect(unseenCountBadge(5, 6)).toBe("");
    expect(unseenCountBadge(2.5, 1)).toBe("");
    expect(unseenCountBadge(5, NaN)).toBe("");
  });

  test("pageTitleWithUnread prefixes only positive integer counts", () => {
    expect(pageTitleWithUnread("pace", 7)).toBe("(7) pace");
    expect(pageTitleWithUnread("pace", 1)).toBe("(1) pace");
    // Caught up (and anything non-count) restores the untouched base title.
    expect(pageTitleWithUnread("pace", 0)).toBe("pace");
    expect(pageTitleWithUnread("pace", -1)).toBe("pace");
    expect(pageTitleWithUnread("pace", 2.5)).toBe("pace");
    expect(pageTitleWithUnread("pace", "7")).toBe("pace");
    expect(pageTitleWithUnread("pace", NaN)).toBe("pace");
    // A broken base can never leak "undefined" into the tab.
    expect(pageTitleWithUnread(undefined, 3)).toBe("");
  });

  test("faviconHref renders an inline SVG with a dot only for positive integer counts", () => {
    const plain = faviconHref(0);
    expect(plain.startsWith("data:image/svg+xml,")).toBe(true);
    const plainSvg = decodeURIComponent(plain.slice("data:image/svg+xml,".length));
    // A real standalone SVG (xmlns) carrying the pace monogram, no dot.
    expect(plainSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(plainSvg).toContain(">p</text>");
    expect(plainSvg).not.toContain("<circle");
    // Unread: same icon plus the dot. Same count rules as pageTitleWithUnread.
    const unread = decodeURIComponent(faviconHref(3).slice("data:image/svg+xml,".length));
    expect(unread).toContain("<circle");
    // Untrusted DOM-derived counts degrade to the plain icon, never garbage.
    for (const count of [-1, 2.5, "7", NaN, undefined, null]) {
      expect(faviconHref(count)).toBe(plain);
    }
  });

  test("the favicon dot renders the unread count as a digit when it fits (1-9), plain dot at 10+", () => {
    for (const count of [1, 5, 9]) {
      const svg = faviconSvg(count);
      expect(svg).toContain("<circle");
      expect(svg).toContain(`>${count}</text>`);
    }
    // Two digits would be illegible at favicon size: the dot goes plain.
    for (const count of [10, 42, 1000]) {
      const svg = faviconSvg(count);
      expect(svg).toContain("<circle");
      expect(svg.match(/<text/g)).toHaveLength(1); // only the "p" monogram
    }
    // The digit sits inside the dot's circle (white on the accent red).
    expect(faviconSvg(7)).toContain('fill="#ffffff">7</text>');
    // Zero/invalid counts never render a digit either (plain icon).
    expect(faviconSvg(0).match(/<text/g)).toHaveLength(1);
  });

  test("the server renders an icon link: /favicon.svg live, embedded data: URL in static exports", () => {
    const interactive = renderModeDashboard("interactive");
    expect(interactive).toContain('rel="icon"');
    expect(interactive).toContain('href="/favicon.svg"');
    // Static exports have no server to serve the asset, so the same plain
    // monogram is embedded self-contained.
    const staticHtml = renderModeDashboard("static");
    expect(staticHtml).toContain('rel="icon"');
    expect(staticHtml).not.toContain("/favicon.svg");
    expect(staticHtml).toContain("data:image/svg+xml,");
  });

  test("faviconSvg is the raw markup behind faviconHref (shared with the server route)", () => {
    expect(faviconHref(0)).toBe(`data:image/svg+xml,${encodeURIComponent(faviconSvg(0))}`);
    expect(faviconSvg(0)).not.toContain("<circle");
    expect(faviconSvg(2)).toContain("<circle");
  });

  test("the unseen-count badge is client-injected: the server never renders it", () => {
    for (const mode of ["interactive", "static"] as const) {
      expect(renderModeDashboard(mode)).not.toContain(UNSEEN_COUNT_CLASS);
    }
  });

  test("the hidden-count badge is client-injected: the server never renders it", () => {
    for (const mode of ["interactive", "static"] as const) {
      expect(renderModeDashboard(mode)).not.toContain(HIDDEN_COUNT_CLASS);
    }
  });

  test("the toolbar is client-injected: the server never renders it", () => {
    for (const mode of ["interactive", "static"] as const) {
      const html = renderModeDashboard(mode);
      expect(html).not.toContain(TOOLBAR_CLASS);
      expect(html).not.toContain(THEME_BTN_CLASS);
      expect(html).not.toContain(HIDE_SEEN_BTN_CLASS);
      expect(html).not.toContain(FILTER_BTN_CLASS);
      expect(html).not.toContain(HELP_BTN_CLASS);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Serving the script                                                  */
/* ------------------------------------------------------------------ */

describe("GET /dashboard.js", () => {
  const layout = flexCfg("row", [panelCfg("Feed", "rss")]);

  test("serves the module with a JS content type and security headers", async () => {
    const app = createTestServerApp(makeServerRouteDeps({ layout }));
    const res = await requestServerRoute(app, "/dashboard.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    expectSecurityHeaders(res);
    const body = await res.text();
    expect(body).toContain("keydown");
    expect(body).toContain("prefers-reduced-motion");
  });

  test("is served under a configured base path too", async () => {
    const app = createTestServerApp(
      makeServerRouteDeps({ layout, basePath: normalizeBasePath("pace") }),
    );
    const res = await requestServerRoute(app, "/pace/dashboard.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
  });
});

/* ------------------------------------------------------------------ */
/* Stylesheet contract                                                 */
/* ------------------------------------------------------------------ */

const STYLES = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");

describe("keyboard navigation CSS", () => {
  test("focus-visible ring uses the theme accent on item links and refresh buttons", () => {
    const match = STYLES.match(
      /\.item-title a:focus-visible[^{]*\{([^}]*)\}/s,
    );
    expect(match).not.toBeNull();
    const selectorAndBlock = STYLES.slice(STYLES.indexOf(".item-title a:focus-visible"));
    const selector = selectorAndBlock.slice(0, selectorAndBlock.indexOf("{"));
    expect(selector).toContain(".refresh-btn:focus-visible");
    expect(match![1]).toContain("outline: 2px solid var(--accent)");
    expect(match![1]).toContain("outline-offset");
  });

  test("help overlay is styled, hidden by [hidden], and uses theme variables", () => {
    const overlay = STYLES.match(/\n\.kbd-help\s*\{([^}]*)\}/s);
    expect(overlay).not.toBeNull();
    expect(overlay![1]).toContain("position: fixed");
    expect(overlay![1]).toContain("var(--bg-elevated)");

    const hidden = STYLES.match(/\.kbd-help\[hidden\]\s*\{([^}]*)\}/s);
    expect(hidden).not.toBeNull();
    expect(hidden![1]).toContain("display: none");

    expect(STYLES).toContain(".kbd-help kbd");
    expect(STYLES).toContain(".kbd-help-close");
  });

  test("filter bar is styled, hidden by [hidden], and filtered items collapse", () => {
    const bar = STYLES.match(/\n\.item-filter\s*\{([^}]*)\}/s);
    expect(bar).not.toBeNull();
    expect(bar![1]).toContain("position: fixed");
    expect(bar![1]).toContain("var(--bg-elevated)");

    const hiddenBar = STYLES.match(/\.item-filter\[hidden\]\s*\{([^}]*)\}/s);
    expect(hiddenBar).not.toBeNull();
    expect(hiddenBar![1]).toContain("display: none");

    const hiddenItem = STYLES.match(/\.item\[hidden\]\s*\{([^}]*)\}/s);
    expect(hiddenItem).not.toBeNull();
    expect(hiddenItem![1]).toContain("display: none");

    expect(STYLES).toContain(".item-filter-input");
    expect(STYLES).toContain(".item-filter-count");
    expect(STYLES).toContain(".panel.filter-no-match");

    // The subscribe link is styled and disappears with the empty query.
    expect(STYLES).toContain(".item-filter-subscribe");
    const hiddenSubscribe = STYLES.match(/\.item-filter-subscribe\[hidden\]\s*\{([^}]*)\}/s);
    expect(hiddenSubscribe).not.toBeNull();
    expect(hiddenSubscribe![1]).toContain("display: none");
  });

  test("collapsed panels hide the body, counter grid, and fade gradient", () => {
    const rule = STYLES.match(/\.panel\.panel-collapsed[^{]*\{([^}]*)\}/s);
    expect(rule).not.toBeNull();
    const start = STYLES.indexOf(".panel.panel-collapsed");
    const selector = STYLES.slice(start, STYLES.indexOf("{", start));
    expect(selector).toContain(".panel.panel-collapsed .panel-body");
    expect(selector).toContain(".panel.panel-collapsed .counter-panel");
    expect(selector).toContain(".panel.panel-collapsed::after");
    expect(rule![1]).toContain("display: none");
  });

  test("seen items are dimmed but regain full opacity on hover/focus", () => {
    const dim = STYLES.match(/\.item\.item-seen\s*\{([^}]*)\}/s);
    expect(dim).not.toBeNull();
    expect(dim![1]).toContain("opacity");
    const restore = STYLES.match(/\.item\.item-seen:hover,\s*\.item\.item-seen:focus-within\s*\{([^}]*)\}/s);
    expect(restore).not.toBeNull();
    expect(restore![1]).toContain("opacity: 1");
  });

  test("hide-seen mode hides seen items and dims fully-seen panels", () => {
    const hide = STYLES.match(/html\.hide-seen \.panel:not\(\[data-hide-seen="off"\]\) \.item\.item-seen[^{]*\{([^}]*)\}/s);
    expect(hide).not.toBeNull();
    expect(hide![1]).toContain("display: none");
    const dim = STYLES.match(/html\.hide-seen \.panel\.all-seen[^{]*\{([^}]*)\}/s);
    expect(dim).not.toBeNull();
    expect(dim![1]).toContain("opacity");
  });

  test("light theme block shadows every dark token and restyles source badges", () => {
    const light = STYLES.match(/:root\[data-theme='light'\]\s*\{([^}]*)\}/s);
    expect(light).not.toBeNull();
    // Every color token defined on bare :root must be shadowed by the light
    // theme (fonts and derived color-mix tokens inherit automatically).
    const root = STYLES.match(/\n:root\s*\{([^}]*)\}/s);
    const colorTokens = [...root![1]!.matchAll(/(--[\w-]+):\s*#/g)].map((m) => m[1]!);
    expect(colorTokens.length).toBeGreaterThan(0);
    for (const token of colorTokens) {
      expect(light![1]).toContain(`${token}:`);
    }
    // Badges swap their dark backgrounds for tints derived from the text color.
    const badge = STYLES.match(
      /:root\[data-theme='light'\] \.item-source\[class\*='src-'\]\s*\{([^}]*)\}/s,
    );
    expect(badge).not.toBeNull();
    expect(badge![1]).toContain("currentColor");
  });

  test("static exports follow the OS light preference with the exact same palette", () => {
    // Static pages run no JS, so the light palette is delivered via a
    // prefers-color-scheme media block scoped to body.static-dashboard.
    // Its declarations must be a verbatim copy of the data-theme='light'
    // blocks the interactive toggle uses — otherwise the palettes drift.
    const declarations = (block: string | undefined) =>
      [...(block ?? "").matchAll(/([\w-]+(?:--[\w-]+)?[\w-]*):\s*([^;]+);/g)]
        .map((m) => `${m[1]}: ${m[2]!.trim()}`)
        .sort();
    const media = STYLES.match(
      /@media \(prefers-color-scheme: light\)\s*\{\s*:root:has\(body\.static-dashboard\)\s*\{([^}]*)\}\s*\}/s,
    );
    expect(media).not.toBeNull();
    const light = STYLES.match(/:root\[data-theme='light'\]\s*\{([^}]*)\}/s);
    expect(declarations(media![1])).toEqual(declarations(light![1]));
    expect(declarations(media![1]).length).toBeGreaterThan(0);
    // Badge overrides must mirror too: every light badge rule has a
    // static-export twin with identical declarations.
    const lightBadges = [
      ...STYLES.matchAll(/:root\[data-theme='light'\] (\.item-source[^\s{]*)\s*\{([^}]*)\}/gs),
    ];
    expect(lightBadges.length).toBeGreaterThan(10);
    for (const [, selector, body] of lightBadges) {
      const esc = selector!.replace(/[.*[\]']/g, (c) => `\\${c}`);
      const twin = STYLES.match(
        new RegExp(`:root:has\\(body\\.static-dashboard\\) ${esc}\\s*\\{([^}]*)\\}`, "s"),
      );
      expect(twin).not.toBeNull();
      expect(declarations(twin![1])).toEqual(declarations(body));
    }
    // And the static twins live inside a prefers-color-scheme: light guard,
    // never bare (which would force light onto dark-preferring viewers).
    const bare = STYLES.split("@media (prefers-color-scheme: light)")[0]!;
    expect(bare).not.toContain(":root:has(body.static-dashboard)");
  });

  test("color-scheme follows the active theme so native UI matches", () => {
    // The browser owns some chrome CSS can't reach (form controls, classic
    // scrollbars, the canvas behind overscroll); color-scheme keeps it in
    // step with the palette: dark by default, light in both light blocks
    // (interactive data-theme toggle and static-export media block — the
    // palette-parity test above keeps the latter two from drifting).
    const block = (selector: RegExp) => STYLES.match(selector)?.[1] ?? "";
    expect(block(/:root\s*\{([^}]*)\}/s)).toContain("color-scheme: dark;");
    expect(block(/:root\[data-theme='light'\]\s*\{([^}]*)\}/s)).toContain("color-scheme: light;");
  });

  test("theme-color metas match the --bg-base tokens and render in every mode", () => {
    // Mobile browser chrome (address bar, task switcher card) reads
    // <meta name="theme-color">: the media pair follows the OS on
    // static/no-JS pages, and applyTheme pins both after a "t" toggle.
    // The colors must stay in lockstep with the stylesheet's --bg-base.
    const block = (selector: RegExp) => STYLES.match(selector)?.[1] ?? "";
    expect(block(/:root\s*\{([^}]*)\}/s)).toContain(`--bg-base: ${THEME_COLORS.dark};`);
    expect(block(/:root\[data-theme='light'\]\s*\{([^}]*)\}/s)).toContain(
      `--bg-base: ${THEME_COLORS.light};`,
    );
    for (const mode of ["interactive", "static"] as const) {
      const html = renderModeDashboard(mode);
      expect(html).toContain(
        `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}"/>`,
      );
      expect(html).toContain(`<meta name="theme-color" content="${THEME_COLORS.dark}"/>`);
    }
  });

  test("the server never renders a theme attribute (theme is client state only)", () => {
    for (const mode of ["interactive", "static"] as const) {
      expect(renderModeDashboard(mode)).not.toContain("data-theme");
    }
  });

  test("overlay adds no animation or transition (nothing new for reduced motion to disable)", () => {
    const start = STYLES.indexOf(".kbd-help");
    const end = STYLES.indexOf("@media (prefers-reduced-motion");
    const overlaySection = STYLES.slice(start, end);
    // Match declarations (colon-suffixed), not prose in comments.
    expect(overlaySection).not.toContain("animation:");
    expect(overlaySection).not.toContain("transition:");
  });
});

describe("mouse affordance CSS", () => {
  test("collapse chevron rotates when its panel is collapsed", () => {
    const rotated = STYLES.match(/\.panel-collapsed \.collapse-btn\s*\{([^}]*)\}/s);
    expect(rotated).not.toBeNull();
    expect(rotated![1]).toContain("rotate");
  });

  test("item seen button is hidden until hover/focus and never swallows clicks", () => {
    const base = STYLES.match(/\.item \.item-seen-btn\s*\{([^}]*)\}/s);
    expect(base).not.toBeNull();
    expect(base![1]).toContain("opacity: 0");
    // A transparent button over the title corner must not intercept clicks.
    expect(base![1]).toContain("pointer-events: none");
    const reveal = STYLES.match(
      /\.item:hover \.item-seen-btn,\s*\.item:focus-within \.item-seen-btn\s*\{([^}]*)\}/s,
    );
    expect(reveal).not.toBeNull();
    expect(reveal![1]).toContain("opacity: 1");
    expect(reveal![1]).toContain("pointer-events: auto");
  });

  test("coarse pointers (no hover) get the item seen button always visible", () => {
    const coarse = STYLES.match(
      /@media \(pointer: coarse\)\s*\{\s*\.item \.item-seen-btn\s*\{([^}]*)\}/s,
    );
    expect(coarse).not.toBeNull();
    expect(coarse![1]).toContain("opacity: 1");
  });

  test("pressed item seen buttons surface the accent so state is visible", () => {
    const pressed = STYLES.match(
      /\.item \.item-seen-btn\[aria-pressed="true"\]\s*\{([^}]*)\}/s,
    );
    expect(pressed).not.toBeNull();
    expect(pressed![1]).toContain("var(--accent)");
  });

  test("chevron transition is disabled for reduced-motion users", () => {
    const start = STYLES.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(STYLES.slice(start)).toContain(".collapse-btn");
  });

  test("toolbar is fixed in the top-right corner on an elevated background", () => {
    const bar = STYLES.match(/\n\.page-toolbar\s*\{([^}]*)\}/s);
    expect(bar).not.toBeNull();
    expect(bar![1]).toContain("position: fixed");
    expect(bar![1]).toContain("top:");
    expect(bar![1]).toContain("right:");
    // Panels scroll under it, so it needs its own opaque backdrop.
    expect(bar![1]).toContain("var(--bg-elevated)");
  });

  test("pressed hide-seen toolbar button surfaces the accent so mode is visible", () => {
    const pressed = STYLES.match(
      /\.page-toolbar \.hide-seen-btn\[aria-pressed="true"\]\s*\{([^}]*)\}/s,
    );
    expect(pressed).not.toBeNull();
    expect(pressed![1]).toContain("var(--accent)");
  });

  test("empty unseen-count badge collapses so panel headers stay clean", () => {
    const empty = STYLES.match(/\.panel-header \.unseen-count:empty\s*\{([^}]*)\}/s);
    expect(empty).not.toBeNull();
    expect(empty![1]).toContain("display: none");
    // The visible badge exists too and stays out of the header's flex squeeze.
    const badge = STYLES.match(/\.panel-header \.unseen-count\s*\{([^}]*)\}/s);
    expect(badge).not.toBeNull();
    expect(badge![1]).toContain("flex-shrink: 0");
  });

  test("empty hidden-count badge collapses so the button stays glyph-only", () => {
    const empty = STYLES.match(
      /\.page-toolbar \.hide-seen-btn \.hidden-count:empty\s*\{([^}]*)\}/s,
    );
    expect(empty).not.toBeNull();
    expect(empty![1]).toContain("display: none");
  });
});
