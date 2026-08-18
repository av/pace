import type { NotifyRuleConfig } from "./config/types";
import {
  filterUnnotifiedKeys,
  getAllItemsByPanel,
  itemSeenKey,
  markKeysNotified,
  type ContentItemRow,
} from "./db";
import { logNotify, warnNotifyDeliveryFailure } from "./notify-warn";
import { compareIsoTimestamp } from "./utils";

/** Payload cap: a first run over a full backlog must not flood the webhook. */
export const MAX_NOTIFY_ITEMS = 20;
/** Per-delivery fetch timeout (ms): a slow webhook must not stall refreshes. */
export const NOTIFY_TIMEOUT_MS = 10_000;

/** One item as serialized into a webhook payload. */
export interface NotifyPayloadItem {
  title: string;
  url: string;
  source: string;
  panel: string;
  timestamp: string;
  score: number | null;
  summary: string | null;
}

/** Body POSTed to a rule's webhook: rule label, total match count, capped items. */
export interface NotifyPayload {
  rule: string;
  matched: number;
  items: NotifyPayloadItem[];
}

/** The label a rule is referred to by in payloads and logs. */
export function notifyRuleLabel(rule: NotifyRuleConfig): string {
  return rule.name ?? rule.url;
}

/**
 * Stable ledger identity for a rule: url plus criteria (NOT the display
 * name), so renaming a rule never re-notifies but changing what it matches
 * (or where it points) starts a fresh ledger.
 */
export function notifyRuleKey(rule: NotifyRuleConfig): string {
  return JSON.stringify({
    url: rule.url,
    min_score: rule.min_score ?? null,
    keywords: rule.keywords ?? null,
    panels: rule.panels ?? null,
  });
}

/**
 * True when the item satisfies EVERY configured criterion: score at or above
 * `min_score` (unscored items never match a score rule), and any of
 * `keywords` present case-insensitively in title, body, or summary (same
 * substring semantics as the `filter` transform).
 */
export function matchesNotifyRule(rule: NotifyRuleConfig, item: ContentItemRow): boolean {
  if (rule.min_score !== undefined) {
    if (item.score === null || item.score < rule.min_score) return false;
  }
  if (rule.keywords !== undefined) {
    const haystack = `${item.title}\n${item.body ?? ""}\n${item.summary ?? ""}`.toLowerCase();
    if (!rule.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) return false;
  }
  return true;
}

function serializeNotifyItem(item: ContentItemRow): NotifyPayloadItem {
  return {
    title: item.title,
    url: item.url,
    source: item.source,
    panel: item.panel_id,
    timestamp: item.timestamp,
    score: item.score,
    summary: item.summary,
  };
}

/**
 * Payload for one delivery: newest matches first, capped at
 * {@link MAX_NOTIFY_ITEMS}; `matched` carries the uncapped total.
 */
export function buildNotifyPayload(rule: NotifyRuleConfig, matches: ContentItemRow[]): NotifyPayload {
  const sorted = [...matches].sort((a, b) => compareIsoTimestamp(a.timestamp, b.timestamp, "desc"));
  return {
    rule: notifyRuleLabel(rule),
    matched: matches.length,
    items: sorted.slice(0, MAX_NOTIFY_ITEMS).map(serializeNotifyItem),
  };
}

export interface RunNotifyRulesDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Evaluate every notify rule against the just-refreshed panels and deliver
 * webhooks for new matches. Never throws: a notification problem must not
 * fail (or re-run) the refresh that triggered it. Matched keys are marked in
 * the ledger only after a 2xx delivery, so failed deliveries retry on the
 * next refresh; everything matched is marked even when the payload is capped,
 * so a backlog notifies once instead of dripping out over cycles.
 */
export async function runNotifyRules(
  rules: readonly NotifyRuleConfig[],
  refreshedPanelIds: readonly string[],
  deps: RunNotifyRulesDeps = {},
): Promise<void> {
  if (rules.length === 0 || refreshedPanelIds.length === 0) return;
  const fetchImpl = deps.fetchImpl ?? fetch;
  for (const rule of rules) {
    const label = notifyRuleLabel(rule);
    try {
      const panelIds = rule.panels
        ? refreshedPanelIds.filter((pid) => rule.panels!.includes(pid))
        : refreshedPanelIds;
      if (panelIds.length === 0) continue;

      // First match per dedup key wins so cross-panel twins notify once.
      const matchesByKey = new Map<string, ContentItemRow>();
      for (const pid of panelIds) {
        for (const item of getAllItemsByPanel(pid)) {
          if (!matchesNotifyRule(rule, item)) continue;
          const key = itemSeenKey(item);
          if (!matchesByKey.has(key)) matchesByKey.set(key, item);
        }
      }
      if (matchesByKey.size === 0) continue;

      const ruleKey = notifyRuleKey(rule);
      const newKeys = filterUnnotifiedKeys(ruleKey, [...matchesByKey.keys()]);
      if (newKeys.length === 0) continue;

      const payload = buildNotifyPayload(
        rule,
        newKeys.map((key) => matchesByKey.get(key)!),
      );
      const res = await fetchImpl(rule.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      });
      if (!res.ok) {
        warnNotifyDeliveryFailure(label, new Error(`webhook responded ${res.status}`));
        continue;
      }
      markKeysNotified(ruleKey, newKeys);
      logNotify(`rule "${label}" - delivered ${payload.items.length} of ${payload.matched} new item(s)`);
    } catch (err) {
      warnNotifyDeliveryFailure(label, err);
    }
  }
}
