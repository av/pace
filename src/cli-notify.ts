import type { NotifyRuleConfig } from "./config/types";
import {
  NOTIFY_TIMEOUT_MS,
  notifyRuleLabel,
  type NotifyPayload,
} from "./notify";
import { errorMessage } from "./utils";

/**
 * Select the rules a `pace notify test` invocation targets: every configured
 * rule, or just the one whose label (name, or url when unnamed) equals
 * `ruleLabel`. Throws with actionable messages when the config has no rules
 * or the label matches none.
 */
export function selectNotifyTestRules(
  rules: readonly NotifyRuleConfig[] | undefined,
  ruleLabel?: string,
): NotifyRuleConfig[] {
  const all = rules ?? [];
  if (all.length === 0) {
    throw new Error(
      "notify: no notify rules configured (add a top-level `notify:` list to the config)",
    );
  }
  if (ruleLabel === undefined) return [...all];
  const matched = all.filter((rule) => notifyRuleLabel(rule) === ruleLabel);
  if (matched.length === 0) {
    const available = all.map((rule) => `"${notifyRuleLabel(rule)}"`).join(", ");
    throw new Error(`notify: no rule named "${ruleLabel}" (configured: ${available})`);
  }
  return matched;
}

/** Human-readable summary of what a rule matches, for the sample item body. */
export function describeNotifyRuleCriteria(rule: NotifyRuleConfig): string {
  const parts: string[] = [];
  if (rule.min_score !== undefined) parts.push(`score >= ${rule.min_score}`);
  if (rule.keywords !== undefined) parts.push(`keywords: ${rule.keywords.join(", ")}`);
  if (rule.panels !== undefined) parts.push(`panels: ${rule.panels.join(", ")}`);
  return parts.join("; ");
}

/**
 * Sample payload for one rule: same shape as a real refresh delivery
 * ({@link NotifyPayload}), carrying a single clearly-labeled test item whose
 * summary spells out the rule's criteria. Score echoes `min_score` so a
 * receiver that formats scores sees a plausible value. Never touches the
 * notified_items ledger.
 */
export function buildNotifyTestPayload(rule: NotifyRuleConfig, now = new Date()): NotifyPayload {
  return {
    rule: notifyRuleLabel(rule),
    matched: 1,
    items: [
      {
        title: `pace notify test: rule "${notifyRuleLabel(rule)}" is wired up`,
        url: "https://github.com/av/pace",
        source: "pace notify test",
        panel: "notify-test",
        timestamp: now.toISOString(),
        score: rule.min_score ?? null,
        summary: `Test delivery from \`pace notify test\`. This rule matches: ${describeNotifyRuleCriteria(rule)}.`,
      },
    ],
  };
}

/** Outcome of one test delivery, ready for CLI reporting. */
export interface NotifyTestResult {
  rule: string;
  url: string;
  ok: boolean;
  /** "200" on success; status or error message on failure. */
  detail: string;
}

export interface NotifyTestDeps {
  fetchImpl?: typeof fetch;
  now?: Date;
}

/**
 * POST a sample payload to each selected rule's webhook, sequentially (test
 * output should read in config order). Uses the same timeout as real
 * deliveries so a hanging endpoint fails the same way it would in production.
 * Never throws: every outcome lands in the result list.
 */
export async function runNotifyTest(
  rules: readonly NotifyRuleConfig[],
  deps: NotifyTestDeps = {},
): Promise<NotifyTestResult[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const results: NotifyTestResult[] = [];
  for (const rule of rules) {
    const label = notifyRuleLabel(rule);
    try {
      const res = await fetchImpl(rule.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildNotifyTestPayload(rule, deps.now)),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });
      results.push({
        rule: label,
        url: rule.url,
        ok: res.ok,
        detail: res.ok ? String(res.status) : `webhook responded ${res.status}`,
      });
    } catch (err) {
      results.push({ rule: label, url: rule.url, ok: false, detail: errorMessage(err) });
    }
  }
  return results;
}

/** One report line per delivery, plus a pass/fail summary line. */
export function formatNotifyTestReport(results: NotifyTestResult[]): {
  lines: string[];
  ok: boolean;
} {
  const lines = results.map((r) =>
    r.ok
      ? `notify: rule "${r.rule}" - test delivery ok (${r.detail}) -> ${r.url}`
      : `notify: rule "${r.rule}" - test delivery FAILED (${r.detail}) -> ${r.url}`,
  );
  const failed = results.filter((r) => !r.ok).length;
  const noun = results.length === 1 ? "rule" : "rules";
  lines.push(
    failed === 0
      ? `notify: ${results.length} ${noun} tested, all deliveries succeeded`
      : `notify: ${results.length} ${noun} tested, ${failed} delivery(ies) failed`,
  );
  return { lines, ok: failed === 0 };
}

export function formatNotifyUsage(): string {
  return `Usage: pace notify test [rule]

Sends a sample webhook delivery to every configured notify rule (or only the
rule whose name matches [rule]) so you can verify endpoints receive pace
payloads before a real high-signal item arrives. The sample uses the exact
payload shape of real deliveries, marked as a test in its title and summary,
and never touches the delivery ledger. Exits non-zero when any delivery fails.

Options:
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -P, --preset <name>   Use a bundled preset (tech-news, ml-ai, etc.)
  -C, --chdir <dir>     Change to directory (for config loads)
`;
}
