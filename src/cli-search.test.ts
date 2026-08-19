import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatSearchFeedUrl,
  formatSearchHit,
  formatMarkSeenSummary,
  formatStarSummary,
  markSearchHitsStarred,
  formatSearchJson,
  formatSearchResults,
  markSearchHitsSeen,
  searchHitSeenKeys,
  formatSearchSummary,
  formatSearchUsage,
  parseSearchCliLimit,
  resolveSearchCliPanelId,
  type SearchStateMarks,
} from "./cli-search";
import {
  getSeenKeys,
  getStarredKeys,
  itemSeenKey,
  saveItems,
  setItemSeen,
  setItemStarred,
} from "./db";
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

describe("parseSearchCliLimit", () => {
  test("shares the API's ?limit= semantics: absent passes through, 1-500 parse", () => {
    expect(parseSearchCliLimit(undefined)).toBeUndefined();
    expect(parseSearchCliLimit("1")).toBe(1);
    expect(parseSearchCliLimit("500")).toBe(500);
  });

  test("rejects out-of-range and non-integer values with a search: error", () => {
    for (const bad of ["0", "501", "-1", "abc", "1.5"]) {
      expect(() => parseSearchCliLimit(bad)).toThrow(/^search: limit must be/);
    }
  });
});

describe("formatSearchJson", () => {
  test("emits the /api/search shape plus starred/seen booleans per item", () => {
    const row = makeContentItemRow({
      panel_id: "tech-panel",
      title: "Rust 2.0",
      url: "https://ex.com/rust",
    });
    const key = itemSeenKey(row);
    const doc = JSON.parse(
      formatSearchJson("rust seen:no", [row], {
        starredKeys: new Set([key]),
        seenKeys: new Set(),
      }),
    );
    expect(doc.query).toBe("rust seen:no");
    expect(doc.count).toBe(1);
    expect(doc.items).toHaveLength(1);
    const item = doc.items[0];
    expect(item.panel).toBe("tech-panel");
    expect(item.title).toBe("Rust 2.0");
    expect(item.url).toBe("https://ex.com/rust");
    expect(item.starred).toBe(true);
    expect(item.seen).toBe(false);
    for (const field of ["id", "source", "timestamp", "fetched_at", "score", "origins"]) {
      expect(item).toHaveProperty(field);
    }
  });

  test("zero matches still yield a parseable document", () => {
    expect(JSON.parse(formatSearchJson("nope", [], NO_MARKS))).toEqual({
      query: "nope",
      count: 0,
      items: [],
    });
  });
});

describe("formatSearchFeedUrl", () => {
  test("URL-encodes the query into /api/search.rss on the given port", () => {
    expect(formatSearchFeedUrl("rust seen:no", 7453)).toBe(
      "http://localhost:7453/api/search.rss?q=rust+seen%3Ano",
    );
  });

  test("keeps a panel: operator inside q and appends the limit when given", () => {
    expect(formatSearchFeedUrl("rust panel:tech-panel", 8080, 5)).toBe(
      "http://localhost:8080/api/search.rss?q=rust+panel%3Atech-panel&limit=5",
    );
  });
});

describe("searchHitSeenKeys / markSearchHitsSeen", () => {
  test("dedupes cross-panel twins down to one read-state key", () => {
    const rows = [
      makeContentItemRow({ panel_id: "tech-panel", url: "https://ex.com/Story/" }),
      makeContentItemRow({ panel_id: "all-panel", url: "https://ex.com/story" }),
      makeContentItemRow({ panel_id: "tech-panel", url: "https://ex.com/other" }),
    ];
    expect(searchHitSeenKeys(rows)).toEqual(["https://ex.com/story", "https://ex.com/other"]);
  });

  test("marks every hit's story seen in the db and reports the distinct count", () => {
    const rows = [
      makeContentItemRow({ panel_id: "tech-panel", url: "https://ex.com/a" }),
      makeContentItemRow({ panel_id: "all-panel", url: "https://ex.com/a" }),
      makeContentItemRow({ panel_id: "tech-panel", url: "https://ex.com/b" }),
    ];
    expect(markSearchHitsSeen(rows)).toBe("search: marked 2 stories seen");
    expect(new Set(getSeenKeys())).toEqual(new Set(["https://ex.com/a", "https://ex.com/b"]));
  });

  test("zero hits mark nothing", () => {
    expect(markSearchHitsSeen([])).toBe("search: nothing to mark seen");
    expect(markSearchHitsSeen([], false)).toBe("search: nothing to mark unseen");
    expect(getSeenKeys()).toEqual([]);
  });

  test("seen=false clears the read marks again, twins deduped", () => {
    const rows = [
      makeContentItemRow({ panel_id: "tech-panel", url: "https://ex.com/a" }),
      makeContentItemRow({ panel_id: "all-panel", url: "https://ex.com/a" }),
    ];
    markSearchHitsSeen(rows);
    expect(getSeenKeys()).toEqual(["https://ex.com/a"]);
    expect(markSearchHitsSeen(rows, false)).toBe("search: marked 1 story unseen");
    expect(getSeenKeys()).toEqual([]);
  });

  test("summary wording covers singular, plural, and both directions", () => {
    expect(formatMarkSeenSummary(1)).toBe("search: marked 1 story seen");
    expect(formatMarkSeenSummary(3)).toBe("search: marked 3 stories seen");
    expect(formatMarkSeenSummary(0)).toBe("search: nothing to mark seen");
    expect(formatMarkSeenSummary(1, false)).toBe("search: marked 1 story unseen");
    expect(formatMarkSeenSummary(0, false)).toBe("search: nothing to mark unseen");
  });
});

describe("markSearchHitsStarred / formatStarSummary", () => {
  test("stars every hit's story in the db, twins deduped, and unstars them again", () => {
    const rows = [
      makeContentItemRow({ panel_id: "tech-panel", url: "https://ex.com/a" }),
      makeContentItemRow({ panel_id: "all-panel", url: "https://ex.com/a" }),
      makeContentItemRow({ panel_id: "tech-panel", url: "https://ex.com/b" }),
    ];
    expect(markSearchHitsStarred(rows, true)).toBe("search: starred 2 stories");
    expect(new Set(getStarredKeys())).toEqual(new Set(["https://ex.com/a", "https://ex.com/b"]));
    expect(markSearchHitsStarred(rows.slice(0, 2), false)).toBe("search: unstarred 1 story");
    expect(getStarredKeys()).toEqual(["https://ex.com/b"]);
  });

  test("zero hits mark nothing", () => {
    expect(markSearchHitsStarred([], true)).toBe("search: nothing to star");
    expect(markSearchHitsStarred([], false)).toBe("search: nothing to unstar");
    expect(getStarredKeys()).toEqual([]);
  });

  test("summary wording covers singular, plural, and both directions", () => {
    expect(formatStarSummary(1, true)).toBe("search: starred 1 story");
    expect(formatStarSummary(3, false)).toBe("search: unstarred 3 stories");
    expect(formatStarSummary(0, true)).toBe("search: nothing to star");
  });
});

describe("pace search CLI", () => {
  // Spawn against the test's temp database (installTempDbHooks sets
  // PACE_DB_PATH), so hits seeded in-process are visible to the subprocess.
  function runSearch(args: string[], cwd?: string, env?: Record<string, string | undefined>) {
    return spawnSync(process.execPath, [join(process.cwd(), "src/cli.ts"), "search", ...args], {
      encoding: "utf8" as const,
      stdio: "pipe" as const,
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
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

  test("--json emits a parseable document with state booleans, summary still on stderr", () => {
    seedItems();
    setItemStarred("https://ex.com/rust", true);
    setItemSeen("https://ex.com/go", true);
    const res = runSearch(["--json", "ships"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('search: 2 matches for "ships"');
    const doc = JSON.parse(res.stdout);
    expect(doc.count).toBe(2);
    const byTitle = Object.fromEntries(doc.items.map((i: any) => [i.title, i]));
    expect(byTitle["Rust ships"].starred).toBe(true);
    expect(byTitle["Rust ships"].panel).toBe("tech-panel");
    expect(byTitle["Go ships"].seen).toBe(true);

    const empty = runSearch(["--json", "nothing-here"]);
    expect(empty.status).toBe(0);
    expect(JSON.parse(empty.stdout)).toEqual({ query: "nothing-here", count: 0, items: [] });
  });

  test("--limit caps hits and rejects invalid values like the API", () => {
    seedItems();
    const capped = runSearch(["-n", "1", "ships"]);
    expect(capped.status).toBe(0);
    expect(capped.stderr).toContain('search: 1 match for "ships"');

    const bad = runSearch(["--limit", "0", "ships"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("search: limit must be between 1 and 500");
  });

  test("--rss prints the saved-search feed URL without touching config or db", () => {
    const res = runSearch(["--rss", "rust", "seen:no"], undefined, { PORT: undefined });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("http://localhost:7453/api/search.rss?q=rust+seen%3Ano");
    expect(res.stderr).toBe("");
  });

  test("--rss honors --port / $PORT and --limit, and normalizes the query", () => {
    const flag = runSearch(["--rss", "--port", "9000", "-n", "5", "Rust", "SEEN:no"], undefined, {
      PORT: undefined,
    });
    expect(flag.status).toBe(0);
    expect(flag.stdout.trim()).toBe(
      "http://localhost:9000/api/search.rss?q=Rust+seen%3Ano&limit=5",
    );

    const env = runSearch(["--rss", "rust"], undefined, { PORT: "8123" });
    expect(env.status).toBe(0);
    expect(env.stdout.trim()).toBe("http://localhost:8123/api/search.rss?q=rust");
  });

  test("--rss rejects --json, and --port without --rss is an error", () => {
    const combined = runSearch(["--rss", "--json", "rust"]);
    expect(combined.status).toBe(1);
    expect(combined.stderr).toContain("search: --rss and --json cannot be combined");

    const port = runSearch(["--port", "9000", "rust"]);
    expect(port.status).toBe(1);
    expect(port.stderr).toContain("search: --port is only meaningful with --rss");
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

  test("--mark-seen marks the hits read, printing their pre-mark state", () => {
    seedItems();
    const first = runSearch(["--mark-seen", "ships"]);
    expect(first.status).toBe(0);
    expect(first.stderr).toContain('search: 2 matches for "ships"');
    expect(first.stderr).toContain("search: marked 2 stories seen");
    // Output reflects the state before the marking: nothing shows as read yet.
    expect(first.stdout).not.toContain("· ");
    expect(new Set(getSeenKeys())).toEqual(new Set(["https://ex.com/rust", "https://ex.com/go"]));

    const second = runSearch(["ships"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("· ");

    const none = runSearch(["--mark-seen", "nomatch"]);
    expect(none.status).toBe(0);
    expect(none.stderr).toContain("search: nothing to mark seen");
  });

  test("--star stars the hits, printing their pre-mark state; --unstar clears them", () => {
    seedItems();
    const first = runSearch(["--star", "ships"]);
    expect(first.status).toBe(0);
    expect(first.stderr).toContain("search: starred 2 stories");
    // Output reflects the state before the marking: nothing shows starred yet.
    expect(first.stdout).not.toContain("★");
    expect(new Set(getStarredKeys())).toEqual(
      new Set(["https://ex.com/rust", "https://ex.com/go"]),
    );

    const second = runSearch(["--unstar", "rust"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("★");
    expect(second.stderr).toContain("search: unstarred 1 story");
    expect(getStarredKeys()).toEqual(["https://ex.com/go"]);

    const none = runSearch(["--star", "nomatch"]);
    expect(none.status).toBe(0);
    expect(none.stderr).toContain("search: nothing to star");
  });

  test("--star/--unstar guards: not together, not with --rss", () => {
    const both = runSearch(["--star", "--unstar", "rust"]);
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("search: --star and --unstar cannot be combined");
    const rss = runSearch(["--rss", "--star", "rust"]);
    expect(rss.status).toBe(1);
    expect(rss.stderr).toContain("search: --rss and --star/--unstar cannot be combined");
  });

  test("--rss rejects --mark-seen", () => {
    const res = runSearch(["--rss", "--mark-seen", "rust"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("search: --rss and --mark-seen cannot be combined");
  });

  test("--mark-unseen clears the read marks, printing the pre-mark state", () => {
    seedItems();
    runSearch(["--mark-seen", "ships"]);
    expect(getSeenKeys().length).toBe(2);

    const res = runSearch(["--mark-unseen", "ships"]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("search: marked 2 stories unseen");
    // Output reflects the state before the clearing: hits still show as read.
    expect(res.stdout).toContain("· ");
    expect(getSeenKeys()).toEqual([]);

    const none = runSearch(["--mark-unseen", "nomatch"]);
    expect(none.status).toBe(0);
    expect(none.stderr).toContain("search: nothing to mark unseen");
  });

  test("--mark-unseen guards: not with --mark-seen, not with --rss", () => {
    const both = runSearch(["--mark-seen", "--mark-unseen", "rust"]);
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("search: --mark-seen and --mark-unseen cannot be combined");
    const rss = runSearch(["--rss", "--mark-unseen", "rust"]);
    expect(rss.status).toBe(1);
    expect(rss.stderr).toContain("search: --rss and --mark-unseen cannot be combined");
  });

  test("serve-only options are rejected", () => {
    const res = runSearch(["rust", "--renderer-url", "http://x"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s) for this command: --renderer-url");
  });
});
