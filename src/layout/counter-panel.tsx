import type { FC } from "hono/jsx";
import type { DashboardRenderMode, PanelConfig, PanelData } from "./types";
import { resolvePanelId } from "./types";
import { relativeTime } from "../utils";
import { flexStyle } from "./flex-styles";

interface CounterBody {
  value: unknown;
  unit?: string;
  previous?: unknown;
}

export function parseCounterBody(body: string | null | undefined): CounterBody | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "value" in parsed) {
      return parsed as CounterBody;
    }
    return null;
  } catch {
    return null;
  }
}

/** Format a divided number with at most one decimal, dropping trailing ".0". */
function formatAbbreviated(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
}

/**
 * Abbreviation tiers, largest first. `min` is the threshold at which the tier
 * kicks in (the "k" tier only starts at 10 000 so 4-digit values stay exact).
 */
const ABBREVIATION_TIERS: ReadonlyArray<{ divisor: number; suffix: string; min: number }> = [
  { divisor: 1e12, suffix: "T", min: 1e12 },
  { divisor: 1e9, suffix: "B", min: 1e9 },
  { divisor: 1e6, suffix: "M", min: 1e6 },
  { divisor: 1e3, suffix: "k", min: 10_000 },
];

/** Abbreviate large numbers: 1234 -> "1.2k", 1500000 -> "1.5M". */
export function abbreviateNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1e15) {
    // Beyond trillions, digit strings become unreadable; use exponential.
    return value.toExponential(1).replace("e+", "e");
  }

  for (let i = 0; i < ABBREVIATION_TIERS.length; i++) {
    const tier = ABBREVIATION_TIERS[i]!;
    if (abs < tier.min) continue;
    // If rounding to 1 decimal in this tier would display >= 1000 (e.g.
    // 999.95M -> "1000M"), promote to the next tier up instead ("1B").
    if (Math.round((abs / tier.divisor) * 10) >= 10_000) {
      const up = ABBREVIATION_TIERS[i - 1];
      if (!up) {
        // 999.95T+ rounds past "1000T"; T is the top tier, so go exponential.
        return value.toExponential(1).replace("e+", "e");
      }
      return `${sign}${formatAbbreviated(abs / up.divisor)}${up.suffix}`;
    }
    return `${sign}${formatAbbreviated(abs / tier.divisor)}${tier.suffix}`;
  }

  return String(value);
}

/** Placeholder shown when a counter value cannot be rendered meaningfully. */
export const COUNTER_VALUE_FALLBACK = "—";

const MAX_COUNTER_STRING_LENGTH = 40;

/**
 * Coerce a counter value (arbitrary remote JSON via json_path) to a finite
 * number when possible: numbers pass through, numeric strings ("42", "1e3")
 * are parsed. Everything else returns null.
 */
export function coerceCounterNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Format an arbitrary counter value for display. Finite numbers (including
 * numeric strings) are abbreviated; short non-numeric strings and booleans
 * are shown as-is (e.g. a status endpoint returning "UP"); anything else
 * (objects, arrays, null, NaN, Infinity, overlong strings) falls back to a
 * placeholder instead of rendering "[object Object]"/"NaN".
 */
export function formatCounterValue(value: unknown): { display: string; full: string } {
  const num = coerceCounterNumber(value);
  if (num !== null) {
    return { display: abbreviateNumber(num), full: String(num) };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && trimmed.length <= MAX_COUNTER_STRING_LENGTH) {
      return { display: trimmed, full: trimmed };
    }
    return { display: COUNTER_VALUE_FALLBACK, full: "unavailable" };
  }
  if (typeof value === "boolean") {
    return { display: String(value), full: String(value) };
  }
  return { display: COUNTER_VALUE_FALLBACK, full: "unavailable" };
}

type TrendDirection = "up" | "down" | "flat" | "none";

function getTrend(current: unknown, previous: unknown): TrendDirection {
  if (previous === undefined || previous === null) return "none";
  const cur = coerceCounterNumber(current);
  const prev = coerceCounterNumber(previous);
  if (cur === null || prev === null) return "none";
  if (cur > prev) return "up";
  if (cur < prev) return "down";
  return "flat";
}

const TREND_TEXT: Record<string, string> = { up: "trending up", down: "trending down", flat: "unchanged" };

const TrendArrow: FC<{ trend: TrendDirection }> = ({ trend }) => {
  if (trend === "up") {
    return <span class="stat-trend stat-trend-up" title="Increasing" aria-hidden="true">{"↑"}</span>;
  }
  if (trend === "down") {
    return <span class="stat-trend stat-trend-down" title="Decreasing" aria-hidden="true">{"↓"}</span>;
  }
  return null;
};

const StatCard: FC<{ label: string; data: CounterBody }> = ({ label, data }) => {
  const trend = getTrend(data.value, data.previous);
  const { display: displayValue, full: fullValue } = formatCounterValue(data.value);
  const trendText = TREND_TEXT[trend] ?? "";
  const ariaLabel = [label, fullValue, data.unit, trendText].filter(Boolean).join(", ");

  return (
    <div class="stat-card" role="group" aria-label={ariaLabel}>
      <div class="stat-value">
        {displayValue}
        {data.unit && <span class="stat-unit">{data.unit}</span>}
        <TrendArrow trend={trend} />
      </div>
      <div class="stat-label">{label}</div>
    </div>
  );
};

export const CounterPanel: FC<{ node: PanelConfig; panelData: Map<string, PanelData>; mode: DashboardRenderMode; basePath?: string }> = ({ node, panelData, mode, basePath = "" }) => {
  const data = panelData.get(node.panel);
  const panelId = data?.panelId ?? resolvePanelId(node);
  const items = data?.items ?? [];
  const lastRefreshedAt = data?.lastRefreshedAt;

  const cards: { label: string; data: CounterBody }[] = [];
  for (const item of items) {
    const parsed = parseCounterBody(item.body);
    if (parsed) {
      cards.push({ label: item.title, data: parsed });
    }
  }

  return (
    <div class="flex-panel" style={flexStyle(node.flex)}>
      <div class="panel">
        <div class="panel-header">
          <h2 title={node.panel}>{node.panel}</h2>
          <div class="panel-actions">
            {lastRefreshedAt && <span class="panel-refreshed">{relativeTime(lastRefreshedAt)}</span>}
            {mode === "interactive" && (
              <form method="post" action={`${basePath}/refresh/${encodeURIComponent(panelId)}`}>
                <button type="submit" class="refresh-btn" title="Refresh" aria-label="Refresh">{"↻"}</button>
              </form>
            )}
          </div>
        </div>
        <div class="counter-panel" aria-live="polite">
          {cards.length > 0
            ? cards.map((card) => <StatCard label={card.label} data={card.data} />)
            : <div class="empty-state">No data yet</div>
          }
        </div>
      </div>
    </div>
  );
};
