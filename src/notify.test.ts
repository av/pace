import { describe, test, expect } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import {
  buildNotifyPayload,
  matchesNotifyRule,
  MAX_NOTIFY_ITEMS,
  notifyRuleKey,
  notifyRuleLabel,
  runNotifyRules,
  type NotifyPayload,
} from "./notify";
import {
  filterUnnotifiedKeys,
  getDb,
  itemSeenKey,
  markKeysNotified,
  pruneOldItems,
  saveItems,
} from "./db";
import { validateParsedConfig } from "./config-validate";
import { DEFAULT_LAYOUT } from "./config/domain";
import type { NotifyRuleConfig } from "./config/types";
import { makeContentItem, makeContentItemRow } from "./test/content-items";
import { spyConsole, spyMockCallsContaining } from "./test/console-spy";

installTempDbHooks({ prefix: "pace-notify-" });

const WEBHOOK_URL = "https://hooks.example.com/pace";

function rule(overrides: Partial<NotifyRuleConfig> = {}): NotifyRuleConfig {
  return { url: WEBHOOK_URL, min_score: 8, ...overrides };
}

interface FetchStub {
  calls: { url: string; body: NotifyPayload }[];
  fetchImpl: typeof fetch;
}

function stubFetch(status = 200, opts: { reject?: boolean } = {}): FetchStub {
  const calls: FetchStub["calls"] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    if (opts.reject) throw new Error("connection refused");
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as NotifyPayload });
    return new Response("ok", { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("notify: rule helpers", () => {
  test("notifyRuleLabel prefers name, falls back to url", () => {
    expect(notifyRuleLabel(rule({ name: "alerts" }))).toBe("alerts");
    expect(notifyRuleLabel(rule())).toBe(WEBHOOK_URL);
  });

  test("notifyRuleKey ignores display name but tracks criteria and url", () => {
    expect(notifyRuleKey(rule({ name: "a" }))).toBe(notifyRuleKey(rule({ name: "b" })));
    expect(notifyRuleKey(rule({ min_score: 8 }))).not.toBe(notifyRuleKey(rule({ min_score: 9 })));
    expect(notifyRuleKey(rule())).not.toBe(notifyRuleKey(rule({ url: "https://other.example.com/" })));
    expect(notifyRuleKey(rule({ keywords: ["rust"] }))).not.toBe(notifyRuleKey(rule()));
    expect(notifyRuleKey(rule({ panels: ["news"] }))).not.toBe(notifyRuleKey(rule()));
  });

  test("matchesNotifyRule min_score: unscored items never match, boundary is inclusive", () => {
    const r = rule({ min_score: 8 });
    expect(matchesNotifyRule(r, makeContentItemRow({ score: null }))).toBe(false);
    expect(matchesNotifyRule(r, makeContentItemRow({ score: 7.9 }))).toBe(false);
    expect(matchesNotifyRule(r, makeContentItemRow({ score: 8 }))).toBe(true);
  });

  test("matchesNotifyRule keywords: case-insensitive OR over title/body/summary", () => {
    const r = rule({ min_score: undefined, keywords: ["RuSt", "wasm"] });
    expect(matchesNotifyRule(r, makeContentItemRow({ title: "Why Rust wins", body: null }))).toBe(true);
    expect(matchesNotifyRow(r, { body: "all about WASM runtimes" })).toBe(true);
    expect(matchesNotifyRow(r, { summary: "a rust retrospective" })).toBe(true);
    expect(matchesNotifyRow(r, { title: "go generics", body: "nothing else", summary: null })).toBe(false);
  });

  function matchesNotifyRow(
    r: NotifyRuleConfig,
    overrides: Parameters<typeof makeContentItemRow>[0],
  ): boolean {
    return matchesNotifyRule(r, makeContentItemRow({ title: "t", body: null, summary: null, ...overrides }));
  }

  test("matchesNotifyRule ANDs min_score with keywords when both set", () => {
    const r = rule({ min_score: 5, keywords: ["rust"] });
    expect(matchesNotifyRule(r, makeContentItemRow({ title: "rust", score: 4 }))).toBe(false);
    expect(matchesNotifyRule(r, makeContentItemRow({ title: "go", score: 9 }))).toBe(false);
    expect(matchesNotifyRule(r, makeContentItemRow({ title: "rust", score: 9 }))).toBe(true);
  });

  test("buildNotifyPayload sorts newest first, caps items, keeps uncapped matched count", () => {
    const items = Array.from({ length: MAX_NOTIFY_ITEMS + 5 }, (_, i) =>
      makeContentItemRow({ timestamp: new Date(1700000000000 + i * 1000).toISOString() }),
    );
    const payload = buildNotifyPayload(rule({ name: "hot" }), items);
    expect(payload.rule).toBe("hot");
    expect(payload.matched).toBe(MAX_NOTIFY_ITEMS + 5);
    expect(payload.items).toHaveLength(MAX_NOTIFY_ITEMS);
    expect(payload.items[0].timestamp > payload.items[1].timestamp).toBe(true);
  });

  test("payload items expose only public fields", () => {
    const row = makeContentItemRow({ panel_id: "news", score: 9, summary: "s" });
    const payload = buildNotifyPayload(rule(), [row]);
    expect(payload.items[0]).toEqual({
      title: row.title,
      url: row.url,
      source: row.source,
      panel: "news",
      timestamp: row.timestamp,
      score: 9,
      summary: "s",
    });
  });
});

describe("notify: db ledger", () => {
  test("filterUnnotifiedKeys dedupes input and excludes marked keys per rule", () => {
    markKeysNotified("ruleA", ["k1"]);
    expect(filterUnnotifiedKeys("ruleA", ["k1", "k2", "k2", "k3"])).toEqual(["k2", "k3"]);
    // Same item under a different rule is still unnotified.
    expect(filterUnnotifiedKeys("ruleB", ["k1"])).toEqual(["k1"]);
  });

  test("markKeysNotified is idempotent", () => {
    markKeysNotified("r", ["k1", "k2"]);
    markKeysNotified("r", ["k1"]);
    expect(filterUnnotifiedKeys("r", ["k1", "k2"])).toEqual([]);
  });

  test("pruneOldItems drops aged ledger rows only when no stored item carries the key", () => {
    const item = makeContentItem({ url: "https://ex.com/keep" });
    saveItems("news", [item]);
    const keptKey = itemSeenKey({ id: item.id, url: item.url });
    markKeysNotified("r", [keptKey, "https://ex.com/gone"]);
    getDb().prepare("UPDATE notified_items SET notified_at = datetime('now', '-90 days')").run();
    pruneOldItems(30);
    expect(filterUnnotifiedKeys("r", [keptKey])).toEqual([]);
    expect(filterUnnotifiedKeys("r", ["https://ex.com/gone"])).toEqual(["https://ex.com/gone"]);
  });
});

describe("notify: runNotifyRules", () => {
  function seedPanel(panelId: string, urls: string[], score: number | null = 9): void {
    const rows = urls.map((url, i) =>
      makeContentItem({ url, title: `story ${panelId} ${i}` }),
    );
    saveItems(panelId, rows);
    if (score !== null) {
      getDb().prepare("UPDATE content_items SET score = ? WHERE panel_id = ?").run(score, panelId);
    }
  }

  test("delivers new matches once and skips them on the next run", async () => {
    seedPanel("news", ["https://ex.com/a", "https://ex.com/b"]);
    const stub = stubFetch();
    await spyConsole(["log"], async () => {
      await runNotifyRules([rule()], ["news"], { fetchImpl: stub.fetchImpl });
      await runNotifyRules([rule()], ["news"], { fetchImpl: stub.fetchImpl });
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toBe(WEBHOOK_URL);
    expect(stub.calls[0].body.matched).toBe(2);
    expect(stub.calls[0].body.items.map((i) => i.panel)).toEqual(["news", "news"]);
  });

  test("failed delivery (non-2xx) warns, does not mark, and retries next run", async () => {
    seedPanel("news", ["https://ex.com/a"]);
    const failing = stubFetch(500);
    const ok = stubFetch();
    await spyConsole(["warn", "log"], async ({ warn }) => {
      await runNotifyRules([rule()], ["news"], { fetchImpl: failing.fetchImpl });
      expect(spyMockCallsContaining(warn, "notify: failed to deliver webhook").length).toBe(1);
      await runNotifyRules([rule()], ["news"], { fetchImpl: ok.fetchImpl });
    });
    expect(ok.calls).toHaveLength(1);
  });

  test("thrown fetch errors are caught and warned, never propagated", async () => {
    seedPanel("news", ["https://ex.com/a"]);
    const stub = stubFetch(200, { reject: true });
    await spyConsole(["warn"], async ({ warn }) => {
      await runNotifyRules([rule({ name: "alerts" })], ["news"], { fetchImpl: stub.fetchImpl });
      expect(spyMockCallsContaining(warn, 'rule "alerts"').length).toBe(1);
    });
  });

  test("panel scoping: rule limited to other panels never fires", async () => {
    seedPanel("news", ["https://ex.com/a"]);
    const stub = stubFetch();
    await runNotifyRules([rule({ panels: ["other"] })], ["news"], { fetchImpl: stub.fetchImpl });
    expect(stub.calls).toHaveLength(0);
  });

  test("no delivery when nothing matches the criteria", async () => {
    seedPanel("news", ["https://ex.com/a"], 3);
    const stub = stubFetch();
    await runNotifyRules([rule({ min_score: 8 })], ["news"], { fetchImpl: stub.fetchImpl });
    expect(stub.calls).toHaveLength(0);
  });

  test("cross-panel duplicates notify once (dedup identity key)", async () => {
    seedPanel("news", ["https://ex.com/same"]);
    seedPanel("tech", ["https://ex.com/same"]);
    const stub = stubFetch();
    await spyConsole(["log"], () =>
      runNotifyRules([rule()], ["news", "tech"], { fetchImpl: stub.fetchImpl }),
    );
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].body.matched).toBe(1);
  });

  test("no-op without rules or panels", async () => {
    const stub = stubFetch();
    await runNotifyRules([], ["news"], { fetchImpl: stub.fetchImpl });
    await runNotifyRules([rule()], [], { fetchImpl: stub.fetchImpl });
    expect(stub.calls).toHaveLength(0);
  });
});

describe("notify: config validation", () => {
  function validate(notify: unknown): void {
    validateParsedConfig(
      {
        adapters: [{ type: "hackernews" }],
        layout: { direction: "row", children: [{ panel: "News", source: "hackernews", id: "news" }] },
        notify,
      },
      DEFAULT_LAYOUT,
    );
  }

  test("accepts a full valid rule", () => {
    expect(() =>
      validate([{ url: WEBHOOK_URL, name: "hot", min_score: 8, keywords: ["rust"], panels: ["news"] }]),
    ).not.toThrow();
  });

  test("rejects rules without criteria", () => {
    expect(() => validate([{ url: WEBHOOK_URL }])).toThrow(
      /notify\[0\] must set min_score and\/or keywords/,
    );
  });

  test("rejects unknown fields, bad urls, empty keywords, and unknown panels", () => {
    expect(() => validate([{ url: WEBHOOK_URL, min_score: 8, nope: 1 }])).toThrow(
      /notify\[0\]\.nope is not a valid notify rule field/,
    );
    expect(() => validate([{ url: "ftp://x", min_score: 8 }])).toThrow(/notify\[0\]\.url/);
    expect(() => validate([{ url: WEBHOOK_URL, keywords: [] }])).toThrow(
      /notify\[0\]\.keywords must not be empty/,
    );
    expect(() => validate([{ url: WEBHOOK_URL, min_score: 8, panels: ["nope"] }])).toThrow(
      /notify\[0\]\.panels references unknown panel "nope"/,
    );
    expect(() => validate([{ url: WEBHOOK_URL, min_score: "8" }])).toThrow(
      /notify\[0\]\.min_score must be a number/,
    );
    expect(() => validate("yes")).toThrow(/notify must be a list/);
  });
});
