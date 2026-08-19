import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatSearchHit,
  formatSearchResults,
  formatSearchSummary,
  formatSearchUsage,
  resolveSearchCliPanelId,
  type SearchStateMarks,
} from "./cli-search";
import { itemSeenKey, saveItems, setItemSeen, setItemStarred } from "./db";
import { makeContentItem, makeContentItemRow } from "./test/content-items";
import { installTempDbHooks } from "./test/temp-db";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import type { AppConfig } from "./config/types";

installTempDbHooks({ prefix: "pace-cli-search-" });

const NO_MARKS: SearchStateMarks = { starredKeys: new Set(), seenKeys: new Set() };

function searchConfig(): AppConfig {
  return {
    adapters: [{ name: "hn", type: "hackernews", params: {} }],
    layout: flexCfg("row", [
      panelCfg("Hacker News", "hn", { id: "tech-panel" }),
      panelCfg("Everything", { adapter: "all" }, { id: "all-panel" }),
    ]),
  };
}

describe("formatSearchUsage", () => {
  test("documents the shared /api/search grammar and the state marks", () => {
    const usage = formatSearchUsage();
    expect(usage).toContain("pace search <query...>");
    expect(usage).toContain("starred:yes|no");
    expect(usage).toContain("seen:yes|no");
    expect(usage).toContain("panel:<id>");
    expect(usage).toContain("★");
  });
});

describe("formatSearchHit", () => {
  test("renders timestamp, panel, title and an indented url line", () => {
    const row = makeContentItemRow({
      panel_id: "tech-panel",
      title: "Rust 2.0",
      url: "https://ex.com/rust",
      timestamp: "2026-08-18 12:00:00",
    });
    expect(formatSearchHit(row, NO_MARKS)).toEqual([
      "  2026-08-18 12:00:00  [tech-panel] Rust 2.0",
      "    https://ex.com/rust",
    ]);
  });

  test("marks starred hits with ★ (winning over seen) and seen hits with ·", () => {
    const row = makeContentItemRow({ url: "https://ex.com/a" });
    const key = itemSeenKey(row);
    const starred = formatSearchHit(row, { starredKeys: new Set([key]), seenKeys: new Set([key]) });
    expect(starred[0].startsWith("★ ")).toBe(true);
    const seen = formatSearchHit(row, { starredKeys: new Set(), seenKeys: new Set([key]) });
    expect(seen[0].startsWith("· ")).toBe(true);
  });

  test("collapses newlines in titles and omits the url line for url-less items", () => {
    const row = makeContentItemRow({ title: "line one\n\tline two ", url: "" });
    const lines = formatSearchHit(row, NO_MARKS);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("line one line two");
  });
});

describe("formatSearchSummary", () => {
  test("counts matches with singular/plural and a no-match wording", () => {
    expect(formatSearchSummary("rust", 0)).toBe('search: no matches for "rust"');
    expect(formatSearchSummary("rust", 1)).toBe('search: 1 match for "rust"');
    expect(formatSearchSummary("rust seen:no", 2)).toBe('search: 2 matches for "rust seen:no"');
  });
});

describe("resolveSearchCliPanelId", () => {
  test("resolves panel ids and display names like /api/search's ?panel=", () => {
    expect(resolveSearchCliPanelId(searchConfig(), "tech-panel")).toBe("tech-panel");
    expect(resolveSearchCliPanelId(searchConfig(), "Hacker News")).toBe("tech-panel");
  });

  test("all-items pseudo-panels widen back to an unscoped search", () => {
    expect(resolveSearchCliPanelId(searchConfig(), "all-panel")).toBeUndefined();
  });

  test("unknown panels throw a search:-prefixed error", () => {
    expect(() => resolveSearchCliPanelId(searchConfig(), "nope")).toThrow(
      "search: Unknown panel: nope",
    );
  });
});

describe("formatSearchResults", () => {
  test("joins the hits' lines into one stdout block", () => {
    const rows = [
      makeContentItemRow({ title: "A", url: "https://ex.com/a" }),
      makeContentItemRow({ title: "B", url: "" }),
    ];
    const out = formatSearchResults(rows, NO_MARKS);
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toContain("] A");
    expect(out).toContain("] B");
  });
});

describe("pace search CLI", () => {
  // Spawn against the test's temp database (installTempDbHooks sets
  // PACE_DB_PATH), so hits seeded in-process are visible to the subprocess.
  function runSearch(args: string[], cwd?: string) {
    return spawnSync(process.execPath, [join(process.cwd(), "src/cli.ts"), "search", ...args], {
      encoding: "utf8" as const,
      stdio: "pipe" as const,
      cwd: cwd ?? process.cwd(),
      env: { ...process.env },
    });
  }

  function seedItems() {
    saveItems("tech-panel", [
      makeContentItem({ id: "r1", title: "Rust ships", url: "https://ex.com/rust" }),
      makeContentItem({ id: "g1", title: "Go ships", url: "https://ex.com/go" }),
    ]);
  }

  test("finds matching items, summary on stderr and marked hits on stdout", () => {
    seedItems();
    setItemStarred("https://ex.com/rust", true);
    const res = runSearch(["rust"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('search: 1 match for "rust"');
    expect(res.stdout).toContain("★");
    expect(res.stdout).toContain("[tech-panel] Rust ships");
    expect(res.stdout).toContain("    https://ex.com/rust");
    expect(res.stdout).not.toContain("Go ships");
  });

  test("state operators filter through the stored seen marks", () => {
    seedItems();
    setItemSeen("https://ex.com/go", true);
    const res = runSearch(["ships", "seen:no"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('search: 1 match for "ships seen:no"');
    expect(res.stdout).toContain("Rust ships");
    expect(res.stdout).not.toContain("Go ships");
  });

  test("no matches exits 0 with only the stderr summary", () => {
    const res = runSearch(["nothing-here"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('search: no matches for "nothing-here"');
    expect(res.stdout).toBe("");
  });

  test("panel: operator resolves against the active config", () => {
    seedItems();
    const dir = mkdtempSync(join(tmpdir(), "pace-cli-search-cfg-"));
    try {
      writeFileSync(
        join(dir, "config.yaml"),
        [
          "adapters:",
          "  - name: hn",
          "    type: hackernews",
          "layout:",
          "  direction: row",
          "  children:",
          "    - panel: Hacker News",
          "      id: tech-panel",
          "      source: hn",
        ].join("\n") + "\n",
      );
      const ok = runSearch(["ships", "panel:tech-panel", "--config", join(dir, "config.yaml")]);
      expect(ok.status).toBe(0);
      expect(ok.stderr).toContain('search: 2 matches for "ships panel:tech-panel"');
      const unknown = runSearch(["ships", "panel:nope", "--config", join(dir, "config.yaml")]);
      expect(unknown.status).toBe(1);
      expect(unknown.stderr).toContain("search: Unknown panel: nope");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid operators and a missing query fail with clear errors", () => {
    const bad = runSearch(["seen:ys"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('search: Invalid seen: filter "seen:ys"');

    const missing = runSearch([]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Missing query");
    expect(missing.stdout).toContain("pace search <query...>");
  });

  test("serve-only options are rejected", () => {
    const res = runSearch(["rust", "--port", "8080"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s) for this command: --port");
  });
});
