# Phase 5e — Counter adapter + display mode

Depends on: existing adapter infrastructure, layout rendering.

## Context

Dashboards need prominent numeric readouts — GitHub stars, error rates, deploy
counts, uptime percentages. These should display as large-type stat cards, not
link lists. The counter feature has two parts:

1. A **`counter` adapter** that fetches a JSON endpoint and extracts a value.
2. A **`display: counter` panel flag** that triggers a stat-card renderer.

This reuses the existing adapter/scheduler/refresh infrastructure while adding
a visually distinct panel rendering mode.

## Configuration

### Adapter

```yaml
adapters:
  - name: bun-stars
    type: counter
    params:
      url: https://api.github.com/repos/oven-sh/bun
      json_path: stargazers_count
      label: "Bun Stars"
    refresh_interval: 60

  - name: error-rate
    type: counter
    params:
      url: https://metrics.internal/api/v1/error_rate
      json_path: data.current
      label: "Error Rate"
      unit: "%"
      compare_url: https://metrics.internal/api/v1/error_rate?period=previous
      compare_path: data.current
      headers:
        Authorization: "Bearer ${METRICS_TOKEN}"
    refresh_interval: 5
```

### Panel

```yaml
layout:
  children:
    - panel: Quick Stats
      display: counter
      source:
        - adapter: bun-stars
        - adapter: error-rate
      flex: 1
```

### Params

```typescript
// ADAPTER_PARAM_KEYS addition:
counter: ["url", "json_path", "label", "unit", "compare_url", "compare_path", "headers"],
```

| Param | Required | Type | Notes |
|-------|----------|------|-------|
| `url` | yes | string | JSON endpoint (https or http://localhost) |
| `json_path` | yes | string | Dot-notation path to value (`data.metrics[0].value`) |
| `label` | no | string | Display label (defaults to adapter name) |
| `unit` | no | string | Suffix: `"%"`, `"ms"`, `"k"` |
| `compare_url` | no | string | Endpoint for previous/comparison value |
| `compare_path` | no | string | Path into comparison response (defaults to `json_path`) |
| `headers` | no | object | HTTP headers; supports `${ENV_VAR}` interpolation |

### PanelConfig extension

```typescript
export interface PanelConfig {
  // ... existing fields ...
  display?: "counter";  // triggers alternate renderer
}
```

The `display` field is a string union (not boolean) — future modes like
`"sparkline"` or `"gauge"` extend it.

### Validation

- `url`: required, valid URL (same scheme rules as iframe).
- `json_path`: required, non-empty, matches dot-notation pattern.
- `compare_url`: same rules as `url` if present.
- `headers`: object with string values if present.
- `display` on PanelConfig: if present, must be `"counter"`.

## Behavior

### Adapter fetch

1. HTTP GET to `url` with optional `headers` (env-var interpolated).
2. Parse JSON response.
3. Traverse to `json_path` using simple dot-notation resolver.
4. Optionally fetch `compare_url` and extract comparison value.
5. Return one ContentItem per invocation.

### JSON path resolution

Minimal implementation — no full JSONPath library. Supports:
- Dot notation: `foo.bar.baz`
- Bracket array access: `foo[0].bar`
- Throws on path-not-found.

### Error handling

| Condition | Behavior |
|-----------|----------|
| Network error / timeout | Throw (standard adapter error pattern) |
| Non-200 status | Throw |
| Invalid JSON | Throw |
| Path not found | Throw |
| Value not numeric | Store as-is (supports "UP"/"DOWN" status strings) |
| `compare_url` fails | Warn, continue without trend data |

### ContentItem mapping

| Field | Value |
|-------|-------|
| `id` | `counter:<adapter_name>:<timestamp_ms>` |
| `title` | `label` (or adapter name) |
| `url` | The fetched `url` |
| `source` | Adapter name |
| `body` | JSON: `{"value": 42, "unit": "%", "previous": 38}` |

The `body` field carries structured JSON. The counter renderer parses it; the
standard renderer shows it as raw text (acceptable degradation — counter
adapters should not be in `source: all` panels without `display: counter`).

### Composition

- One adapter = one metric endpoint.
- Multiple counters in one panel via multi-source.
- `limit: 1` is the sensible default for counter panels.

## Visual behavior

### Counter panel renderer

New component: `src/layout/counter-panel.tsx`. Dispatched when
`isPanel(node) && node.display === "counter"`.

- Panel header with title + refresh button (same as standard panels).
- Body is a responsive CSS grid of stat cards (not a link list).
- Each card shows: large value, unit suffix, label, optional trend arrow.
- Trend arrow: ↑ (green) if current > previous, ↓ (red) if lower.
- Large numbers abbreviated: 10k+, 1M+.
- Grid wraps at container width (`auto-fit, minmax(min(100%, 140px), 1fr)`).
- Empty state: "No data yet".

### Fallback

If counter items end up in a panel without `display: counter` (e.g., via
`source: all`), they render as normal cards with raw JSON in the body. This
is documented but not broken.

## Preset examples

| Preset | Use |
|--------|-----|
| `release-tracker` | GitHub stars for tracked repos (bun, hono, etc.) |
| `daily-brief` | Quick stats row: weather temp, inbox count, custom metrics |
| Any | Generic — any JSON API returning a number |

## Files

| File | Change |
|------|--------|
| `src/adapters/counter.ts` | New adapter module |
| `src/adapters/params.ts` | Add `counter` entry |
| `src/adapters/adapter-registry.ts` | Register adapter |
| `src/layout/domain.ts` | Add `display?` to `PanelConfig` |
| `src/layout/counter-panel.tsx` | New renderer component |
| `src/layout/layout-node.tsx` or `panel.tsx` | Dispatch on `display` |
| `src/config-validate.ts` | Validate counter params + `display` field |

## Out of scope

- Sparkline / time-series (future `display: sparkline`).
- Threshold-based color coding (green/yellow/red zones).
- WebSocket / SSE streaming.
- Aggregating multiple readings.
- Authentication flows beyond static headers.
