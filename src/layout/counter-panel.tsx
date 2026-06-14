/** @jsx jsx */
import { jsx } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { PanelConfig, PanelData } from "./types";
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

/** Abbreviate large numbers: 1234 -> "1.2k", 1500000 -> "1.5M". */
export function abbreviateNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    const abbreviated = abs / 1_000_000;
    return `${sign}${abbreviated % 1 === 0 ? abbreviated.toFixed(0) : abbreviated.toFixed(1)}M`;
  }
  if (abs >= 10_000) {
    const abbreviated = abs / 1_000;
    return `${sign}${abbreviated % 1 === 0 ? abbreviated.toFixed(0) : abbreviated.toFixed(1)}k`;
  }

  return String(value);
}

type TrendDirection = "up" | "down" | "flat" | "none";

function getTrend(current: unknown, previous: unknown): TrendDirection {
  if (previous === undefined || previous === null) return "none";
  if (typeof current !== "number" || typeof previous !== "number") return "none";
  if (current > previous) return "up";
  if (current < previous) return "down";
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
  const displayValue = abbreviateNumber(data.value);
  const trendText = TREND_TEXT[trend] ?? "";
  // Use the raw value (not abbreviated) in aria-label so screen readers convey the full number
  const fullValue = String(data.value);
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

export const CounterPanel: FC<{ node: PanelConfig; panelData: Map<string, PanelData> }> = ({ node, panelData }) => {
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
          <h2>{node.panel}</h2>
          <div class="panel-actions">
            {lastRefreshedAt && <span class="panel-refreshed">{relativeTime(lastRefreshedAt)}</span>}
            <form method="POST" action={`/refresh/${encodeURIComponent(panelId)}`}>
              <button type="submit" class="refresh-btn" title="Refresh" aria-label="Refresh">{"↻"}</button>
            </form>
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
