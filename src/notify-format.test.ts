import { describe, test, expect } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import { NOTIFY_FORMATS, renderNotifyDelivery } from "./notify-format";
import { runNotifyRules, type NotifyPayload, type NotifyPayloadItem } from "./notify";
import { validateParsedConfig } from "./config-validate";
import { DEFAULT_LAYOUT } from "./config/domain";
import type { NotifyRuleConfig } from "./config/types";
import { getDb, saveItems } from "./db";
import { makeContentItem } from "./test/content-items";
import { spyConsole } from "./test/console-spy";

installTempDbHooks({ prefix: "pace-notify-format-" });

const WEBHOOK_URL = "https://hooks.example.com/pace";

function item(overrides: Partial<NotifyPayloadItem> = {}): NotifyPayloadItem {
  return {
    title: "Rust 2.0 released",
    url: "https://ex.com/rust",
    source: "Hacker News",
    panel: "news",
    timestamp: "2026-08-19T00:00:00.000Z",
    score: 9,
    summary: null,
    ...overrides,
  };
}

function payload(overrides: Partial<NotifyPayload> = {}): NotifyPayload {
  return { rule: "high-signal", matched: 1, items: [item()], ...overrides };
}

describe("notify-format: renderNotifyDelivery", () => {
  test("json (default) is the raw payload with a JSON content type", () => {
    const p = payload();
    const d = renderNotifyDelivery("json", p);
    expect(JSON.parse(d.body)).toEqual(p);
    expect(d.headers).toEqual({ "Content-Type": "application/json" });
  });

  test("ntfy renders plain text with title and click headers", () => {
    const d = renderNotifyDelivery("ntfy", payload());
    expect(d.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(d.headers["X-Title"]).toBe('pace: 1 new item for "high-signal"');
    expect(d.headers["X-Click"]).toBe("https://ex.com/rust");
    expect(d.body).toBe("• Rust 2.0 released (Hacker News, score 9)\n  https://ex.com/rust");
  });

  test("ntfy sanitizes non-Latin-1 header chars and skips non-ascii X-Click", () => {
    const d = renderNotifyDelivery(
      "ntfy",
      payload({ rule: "héadline", items: [item({ url: "https://ex.com/ünïcode" })] }),
    );
    expect(d.headers["X-Title"]).toBe('pace: 1 new item for "h?adline"');
    expect(d.headers["X-Click"]).toBeUndefined();
    // The body still carries the real characters.
    expect(d.body).toContain("https://ex.com/ünïcode");
  });

  test("ntfy appends an '…and N more' line when the payload is capped", () => {
    const d = renderNotifyDelivery("ntfy", payload({ matched: 25, items: [item(), item()] }));
    expect(d.body.endsWith("…and 23 more")).toBe(true);
  });

  test("discord renders markdown content with escaped link labels", () => {
    const d = renderNotifyDelivery(
      "discord",
      payload({ matched: 2, items: [item({ title: "a [b] *c*", score: null })] }),
    );
    expect(d.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(d.body) as { content: string };
    expect(body.content).toBe(
      '**pace: 2 new items for "high-signal"**\n- [a \\[b\\] \\*c\\*](https://ex.com/rust) — Hacker News\n…and 1 more',
    );
  });

  test("discord drops whole items (never truncates mid-link) to stay under 2000 chars", () => {
    const long = item({ title: "t".repeat(400) });
    const d = renderNotifyDelivery("discord", payload({ matched: 8, items: Array(8).fill(long) }));
    const body = JSON.parse(d.body) as { content: string };
    expect(body.content.length).toBeLessThanOrEqual(2000);
    const shown = body.content.split("\n").filter((l) => l.startsWith("- [")).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(8);
    expect(body.content.endsWith(`…and ${8 - shown} more`)).toBe(true);
  });

  test("slack renders mrkdwn text with escaped <url|title> links", () => {
    const d = renderNotifyDelivery("slack", payload({ items: [item({ title: "a <b> & c" })] }));
    const body = JSON.parse(d.body) as { text: string };
    expect(body.text).toBe(
      '*pace: 1 new item for "high-signal"*\n• <https://ex.com/rust|a &lt;b&gt; &amp; c> — Hacker News, score 9',
    );
  });

  test("every declared format renders without throwing", () => {
    for (const format of NOTIFY_FORMATS) {
      expect(renderNotifyDelivery(format, payload({ matched: 3, items: [] })).body.length).toBeGreaterThan(0);
    }
  });
});

describe("notify-format: delivery wiring", () => {
  test("runNotifyRules posts the rule's format instead of raw JSON", async () => {
    saveItems("news", [makeContentItem({ url: "https://ex.com/a", title: "hot story" })]);
    getDb().prepare("UPDATE content_items SET score = 9 WHERE panel_id = 'news'").run();
    const calls: { headers: Record<string, string>; body: string }[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      calls.push({ headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    await spyConsole(["log"], () =>
      runNotifyRules([{ url: WEBHOOK_URL, min_score: 8, format: "ntfy" }], ["news"], { fetchImpl }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(calls[0].body).toContain("hot story");
    expect(() => JSON.parse(calls[0].body)).toThrow();
  });
});

describe("notify-format: config validation", () => {
  function validate(rule: Record<string, unknown>): void {
    validateParsedConfig(
      {
        adapters: [{ type: "hackernews" }],
        layout: { direction: "row", children: [{ panel: "News", source: "hackernews", id: "news" }] },
        notify: [rule],
      },
      DEFAULT_LAYOUT,
    );
  }

  test("accepts every preset format", () => {
    for (const format of NOTIFY_FORMATS) {
      expect(() => validate({ url: WEBHOOK_URL, min_score: 8, format })).not.toThrow();
    }
  });

  test("rejects unknown formats with the preset list in the message", () => {
    expect(() => validate({ url: WEBHOOK_URL, min_score: 8, format: "teams" })).toThrow(
      /notify\[0\]\.format must be one of json, ntfy, discord, slack/,
    );
  });
});

describe("notify-format: rule identity", () => {
  test("changing format does not restart the delivery ledger", async () => {
    const { notifyRuleKey } = await import("./notify");
    const base: NotifyRuleConfig = { url: WEBHOOK_URL, min_score: 8 };
    expect(notifyRuleKey({ ...base, format: "ntfy" })).toBe(notifyRuleKey(base));
  });
});
