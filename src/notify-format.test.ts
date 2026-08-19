import { describe, test, expect } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import {
  mergeNotifyHeaders,
  NOTIFY_FORMATS,
  renderNotifyDelivery,
  unknownItemTemplatePlaceholders,
  unknownTemplatePlaceholders,
} from "./notify-format";
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
      const template = format === "template" ? "{{headline}}" : undefined;
      expect(
        renderNotifyDelivery(format, payload({ matched: 3, items: [] }), template).body.length,
      ).toBeGreaterThan(0);
    }
  });

  test("template substitutes every placeholder, tolerating inner whitespace", () => {
    const d = renderNotifyDelivery(
      "template",
      payload({ matched: 25, items: [item(), item()] }),
      "rule={{rule}} matched={{ matched }}\n{{headline}}\n{{items}}",
    );
    expect(d.headers).toEqual({ "Content-Type": "text/plain; charset=utf-8" });
    expect(d.body).toBe(
      'rule=high-signal matched=25\npace: 25 new items for "high-signal"\n' +
        "• Rust 2.0 released (Hacker News, score 9)\n  https://ex.com/rust\n" +
        "• Rust 2.0 released (Hacker News, score 9)\n  https://ex.com/rust\n" +
        "…and 23 more",
    );
  });

  test("item_template renders {{items}} one line per item, keeping the overflow line", () => {
    const d = renderNotifyDelivery(
      "template",
      payload({ matched: 25, items: [item(), item({ title: "no score", score: null })] }),
      "{{items}}",
      "{{title}} | {{ url }} | {{source}} | s={{score}} | {{meta}}",
    );
    expect(d.body).toBe(
      "Rust 2.0 released | https://ex.com/rust | Hacker News | s=9 | Hacker News, score 9\n" +
        "no score | https://ex.com/rust | Hacker News | s= | Hacker News\n" +
        "…and 23 more",
    );
  });

  test("without item_template, {{items}} keeps the default bullet list", () => {
    const withOut = renderNotifyDelivery("template", payload(), "{{items}}");
    expect(withOut.body).toBe("• Rust 2.0 released (Hacker News, score 9)\n  https://ex.com/rust");
  });

  test("unknownItemTemplatePlaceholders flags typos and passes known names", () => {
    expect(
      unknownItemTemplatePlaceholders("{{title}} {{url}} {{source}} {{score}} {{meta}}"),
    ).toEqual([]);
    expect(unknownItemTemplatePlaceholders("{{link}} {{Title}} {{link}}")).toEqual([
      "link",
      "Title",
    ]);
  });

  test("{{name_json}} twins substitute JSON literals for a safe JSON envelope", () => {
    const d = renderNotifyDelivery(
      "template",
      payload({
        rule: 'say "hi"',
        matched: 2,
        items: [item({ title: 'A "quoted"\ntitle' }), item({ title: "plain", score: null })],
      }),
      '{"rule": {{rule_json}}, "matched": {{matched_json}}, "headline": {{ headline_json }}, "items": {{items_json}}}',
    );
    const parsed = JSON.parse(d.body) as Record<string, unknown>;
    expect(parsed.rule).toBe('say "hi"');
    expect(parsed.matched).toBe(2);
    expect(parsed.headline).toBe('pace: 2 new items for "say "hi""');
    expect(parsed.items).toContain('A "quoted"\ntitle');
  });

  test("per-item _json twins: strings quoted, score a bare number or null", () => {
    const d = renderNotifyDelivery(
      "template",
      payload({ matched: 2, items: [item(), item({ title: "no score", score: null })] }),
      "[{{items}}]",
      '{"title": {{title_json}}, "url": {{url_json}}, "source": {{source_json}}, "score": {{score_json}}, "meta": {{meta_json}}},',
    );
    const parsed = JSON.parse(d.body.replace(",]", "]")) as Array<Record<string, unknown>>;
    expect(parsed[0]).toEqual({
      title: "Rust 2.0 released",
      url: "https://ex.com/rust",
      source: "Hacker News",
      score: 9,
      meta: "Hacker News, score 9",
    });
    expect(parsed[1]!.score).toBeNull();
    expect(parsed[1]!.meta).toBe("Hacker News");
  });

  test("_json placeholders pass config validation in both templates", () => {
    expect(unknownTemplatePlaceholders("{{rule_json}} {{matched_json}} {{headline_json}} {{items_json}}")).toEqual([]);
    expect(
      unknownItemTemplatePlaceholders("{{title_json}} {{url_json}} {{source_json}} {{score_json}} {{meta_json}}"),
    ).toEqual([]);
    expect(unknownTemplatePlaceholders("{{rule_JSON}}")).toEqual(["rule_JSON"]);
  });

  test("{{items_json_array}} substitutes the item objects as a real JSON array", () => {
    const d = renderNotifyDelivery(
      "template",
      payload({ matched: 2, items: [item({ title: 'A "quoted"\ntitle' }), item({ title: "plain", score: null })] }),
      '{"rule": {{rule_json}}, "items": {{items_json_array}}}',
    );
    const parsed = JSON.parse(d.body) as { rule: string; items: NotifyPayloadItem[] };
    // The full NotifyPayloadItem shape, exactly what the `json` format sends.
    expect(parsed.items).toEqual([item({ title: 'A "quoted"\ntitle' }), item({ title: "plain", score: null })]);
    // Presentation only: item_template reshapes {{items}}, never the array.
    const shaped = renderNotifyDelivery(
      "template",
      payload({ matched: 1 }),
      "{{items_json_array}}",
      "{{title}}",
    );
    expect(JSON.parse(shaped.body)).toEqual([item()]);
    expect(unknownTemplatePlaceholders("{{items_json_array}}")).toEqual([]);
    expect(unknownItemTemplatePlaceholders("{{items_json_array}}")).toEqual(["items_json_array"]);
  });

  test("template format without a template throws (validation prevents this)", () => {
    expect(() => renderNotifyDelivery("template", payload())).toThrow(/requires a template/);
  });

  test("unknownTemplatePlaceholders flags typos and passes known names", () => {
    expect(unknownTemplatePlaceholders("{{rule}} {{matched}} {{headline}} {{items}}")).toEqual([]);
    expect(unknownTemplatePlaceholders("{{item}} and {{ITEMS}} and {{item}}")).toEqual([
      "item",
      "ITEMS",
    ]);
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

  test("runNotifyRules delivers a rule's user-defined template body", async () => {
    saveItems("news", [makeContentItem({ url: "https://ex.com/t", title: "template story" })]);
    getDb().prepare("UPDATE content_items SET score = 9 WHERE panel_id = 'news'").run();
    const calls: { headers: Record<string, string>; body: string }[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      calls.push({ headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const rule: NotifyRuleConfig = {
      url: WEBHOOK_URL,
      min_score: 8,
      format: "template",
      template: "ALERT {{matched}}: {{items}}",
      item_template: "<{{url}}|{{title}}>",
      headers: { "Content-Type": "application/json" },
    };
    await spyConsole(["log"], () => runNotifyRules([rule], ["news"], { fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toBe("ALERT 1: <https://ex.com/t|template story>");
    // Custom Content-Type wins over the template default (text/plain).
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
  });

  test("runNotifyRules sends the rule's custom headers merged over the preset's", async () => {
    saveItems("news", [makeContentItem({ url: "https://ex.com/b", title: "auth story" })]);
    getDb().prepare("UPDATE content_items SET score = 9 WHERE panel_id = 'news'").run();
    const calls: { headers: Record<string, string> }[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      calls.push({ headers: init?.headers as Record<string, string> });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const rule: NotifyRuleConfig = {
      url: WEBHOOK_URL,
      min_score: 8,
      format: "ntfy",
      headers: { Authorization: "Bearer tk_secret", "x-title": "custom title" },
    };
    await spyConsole(["log"], () => runNotifyRules([rule], ["news"], { fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(calls[0].headers["Authorization"]).toBe("Bearer tk_secret");
    // Custom header replaces the preset's X-Title case-insensitively.
    expect(calls[0].headers["x-title"]).toBe("custom title");
    expect(calls[0].headers["X-Title"]).toBeUndefined();
    expect(calls[0].headers["Content-Type"]).toBe("text/plain; charset=utf-8");
  });
});

describe("notify-format: mergeNotifyHeaders", () => {
  test("returns the preset untouched when the rule has no custom headers", () => {
    const preset = { "Content-Type": "application/json" };
    expect(mergeNotifyHeaders(preset, undefined)).toBe(preset);
  });

  test("custom headers win case-insensitively; preset extras survive", () => {
    expect(
      mergeNotifyHeaders(
        { "Content-Type": "text/plain; charset=utf-8", "X-Title": "preset", "X-Click": "https://ex.com" },
        { "X-TITLE": "custom", Authorization: "Bearer t" },
      ),
    ).toEqual({
      "Content-Type": "text/plain; charset=utf-8",
      "X-Click": "https://ex.com",
      "X-TITLE": "custom",
      Authorization: "Bearer t",
    });
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
      const rule: Record<string, unknown> = { url: WEBHOOK_URL, min_score: 8, format };
      if (format === "template") rule.template = "{{headline}}";
      expect(() => validate(rule)).not.toThrow();
    }
  });

  test("format: template requires a non-empty template", () => {
    expect(() => validate({ url: WEBHOOK_URL, min_score: 8, format: "template" })).toThrow(
      /notify\[0\]\.template must be a non-empty string when format is "template"/,
    );
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, format: "template", template: "" }),
    ).toThrow(/notify\[0\]\.template must be a non-empty string/);
  });

  test("template placeholder typos fail config check with the valid list", () => {
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, format: "template", template: "{{item}} {{rule}}" }),
    ).toThrow(
      /notify\[0\]\.template has unknown placeholder\(s\) \{\{item\}\} — valid placeholders: \{\{rule\}\}, \{\{matched\}\}, \{\{headline\}\}, \{\{items\}\}, \{\{rule_json\}\}, \{\{matched_json\}\}, \{\{headline_json\}\}, \{\{items_json\}\}/,
    );
  });

  test("item_template must be a non-empty string with known per-item placeholders", () => {
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, format: "template", template: "{{items}}", item_template: "" }),
    ).toThrow(/notify\[0\]\.item_template must be a non-empty string/);
    expect(() =>
      validate({
        url: WEBHOOK_URL,
        min_score: 8,
        format: "template",
        template: "{{items}}",
        item_template: "{{link}} {{title}}",
      }),
    ).toThrow(
      /notify\[0\]\.item_template has unknown placeholder\(s\) \{\{link\}\} — valid placeholders: \{\{title\}\}, \{\{url\}\}, \{\{source\}\}, \{\{score\}\}, \{\{meta\}\}, \{\{title_json\}\}, \{\{url_json\}\}, \{\{source_json\}\}, \{\{score_json\}\}, \{\{meta_json\}\}/,
    );
    expect(() =>
      validate({
        url: WEBHOOK_URL,
        min_score: 8,
        format: "template",
        template: "{{items}}",
        item_template: "{{title}} — {{url}}",
      }),
    ).not.toThrow();
  });

  test("item_template without format: template is rejected", () => {
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, item_template: "{{title}}" }),
    ).toThrow(/notify\[0\]\.item_template is only valid with format: template \(got format "json"\)/);
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, format: "ntfy", item_template: "{{title}}" }),
    ).toThrow(/item_template is only valid with format: template \(got format "ntfy"\)/);
  });

  test("template without format: template is rejected", () => {
    expect(() => validate({ url: WEBHOOK_URL, min_score: 8, template: "{{headline}}" })).toThrow(
      /notify\[0\]\.template is only valid with format: template \(got format "json"\)/,
    );
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, format: "ntfy", template: "{{headline}}" }),
    ).toThrow(/only valid with format: template \(got format "ntfy"\)/);
  });

  test("format: template may set Content-Type (the user owns the body there)", () => {
    expect(() =>
      validate({
        url: WEBHOOK_URL,
        min_score: 8,
        format: "template",
        template: '{"text": "{{headline}}"}',
        headers: { "Content-Type": "application/json" },
      }),
    ).not.toThrow();
    // Preset formats still reject it.
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, format: "ntfy", headers: { "Content-Type": "application/json" } }),
    ).toThrow(/must not set Content-Type/);
  });

  test("rejects unknown formats with the preset list in the message", () => {
    expect(() => validate({ url: WEBHOOK_URL, min_score: 8, format: "teams" })).toThrow(
      /notify\[0\]\.format must be one of json, ntfy, discord, slack/,
    );
  });

  test("accepts a headers map of auth-style headers", () => {
    expect(() =>
      validate({
        url: WEBHOOK_URL,
        min_score: 8,
        headers: { Authorization: "Bearer tk_secret", "X-Api-Key": "k" },
      }),
    ).not.toThrow();
  });

  test("rejects non-map headers", () => {
    expect(() => validate({ url: WEBHOOK_URL, min_score: 8, headers: ["Authorization"] })).toThrow(
      /notify\[0\]\.headers must be a map/,
    );
  });

  test("rejects invalid header names", () => {
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, headers: { "Bad Name": "v" } }),
    ).toThrow(/notify\[0\]\.headers has invalid header name "Bad Name"/);
  });

  test("rejects Content-Type overrides in any casing", () => {
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, headers: { "content-type": "text/csv" } }),
    ).toThrow(/must not set Content-Type/);
  });

  test("rejects empty and newline-carrying header values", () => {
    expect(() => validate({ url: WEBHOOK_URL, min_score: 8, headers: { "X-Api-Key": "" } })).toThrow(
      /notify\[0\]\.headers\.X-Api-Key must be a non-empty string/,
    );
    expect(() =>
      validate({ url: WEBHOOK_URL, min_score: 8, headers: { "X-Api-Key": "a\r\nInjected: b" } }),
    ).toThrow(/must not contain newline characters/);
  });
});

describe("notify-format: rule identity", () => {
  test("changing format does not restart the delivery ledger", async () => {
    const { notifyRuleKey } = await import("./notify");
    const base: NotifyRuleConfig = { url: WEBHOOK_URL, min_score: 8 };
    expect(notifyRuleKey({ ...base, format: "ntfy" })).toBe(notifyRuleKey(base));
  });

  test("changing or editing a template does not restart the delivery ledger", async () => {
    const { notifyRuleKey } = await import("./notify");
    const base: NotifyRuleConfig = { url: WEBHOOK_URL, min_score: 8 };
    expect(notifyRuleKey({ ...base, format: "template", template: "{{headline}}" })).toBe(
      notifyRuleKey(base),
    );
    expect(
      notifyRuleKey({ ...base, format: "template", template: "{{items}}", item_template: "{{title}}" }),
    ).toBe(notifyRuleKey(base));
  });

  test("changing headers (e.g. rotating a token) does not restart the ledger", async () => {
    const { notifyRuleKey } = await import("./notify");
    const base: NotifyRuleConfig = { url: WEBHOOK_URL, min_score: 8 };
    expect(notifyRuleKey({ ...base, headers: { Authorization: "Bearer new" } })).toBe(
      notifyRuleKey(base),
    );
  });
});
