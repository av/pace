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
  shouldIgnoreKeydown,
  COLLAPSE_STORAGE_KEY,
  parseStoredPanelIds,
  togglePanelId,
  THEME_STORAGE_KEY,
  parseStoredTheme,
  nextTheme,
  SEEN_CLASS,
  parseSeenKeys,
  HIDE_SEEN_CLASS,
  HIDE_SEEN_STORAGE_KEY,
  parseStoredHideSeen,
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

describe("HELP_ROWS", () => {
  test("documents every advertised shortcut", () => {
    const keys = HELP_ROWS.map(([k]) => k).join(" ");
    for (const fragment of ["j / k", "h / l", "Tab", "Enter", "r", "c", "t", "x", "X", "/", "?", "Esc"]) {
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
});

describe("hide-seen mode helpers", () => {
  test("HIDE_SEEN_STORAGE_KEY is a stable, namespaced localStorage key", () => {
    expect(HIDE_SEEN_STORAGE_KEY).toBe("pace.hide-seen");
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
    const hide = STYLES.match(/html\.hide-seen \.item\.item-seen\s*\{([^}]*)\}/s);
    expect(hide).not.toBeNull();
    expect(hide![1]).toContain("display: none");
    const dim = STYLES.match(/html\.hide-seen \.panel\.all-seen\s*\{([^}]*)\}/s);
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
