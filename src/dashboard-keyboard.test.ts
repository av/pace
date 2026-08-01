import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HELP_ROWS,
  KEY_MOVES,
  isTypingTarget,
  keyMove,
  moveIndex,
  shouldIgnoreKeydown,
} from "./dashboard.js";
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

describe("HELP_ROWS", () => {
  test("documents every advertised shortcut", () => {
    const keys = HELP_ROWS.map(([k]) => k).join(" ");
    for (const fragment of ["j / k", "h / l", "Tab", "Enter", "r", "?", "Esc"]) {
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

  test("overlay adds no animation or transition (nothing new for reduced motion to disable)", () => {
    const start = STYLES.indexOf(".kbd-help");
    const end = STYLES.indexOf("@media (prefers-reduced-motion");
    const overlaySection = STYLES.slice(start, end);
    // Match declarations (colon-suffixed), not prose in comments.
    expect(overlaySection).not.toContain("animation:");
    expect(overlaySection).not.toContain("transition:");
  });
});
