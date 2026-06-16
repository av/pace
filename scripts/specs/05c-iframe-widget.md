# Phase 5c — Iframe widget

Depends on: `05-widget-infrastructure.md` (shared union, guards, dispatch).

## Context

Dashboards often need to embed external tools — Grafana dashboards, status
pages, CI dashboards, weather widgets. The iframe widget embeds a URL directly.
It's a new layout leaf node with no adapter interaction.

Key constraint: Pace ships zero client-side JavaScript. Loading states and
error detection must be CSS-only.

## Configuration

```yaml
layout:
  direction: row
  children:
    - iframe: https://grafana.local/d/abc?orgId=1
      title: System Metrics
      flex: 2
      aspect_ratio: "16/9"

    - iframe: https://status.example.com/embed
      height: "400px"
      sandbox: "allow-scripts allow-same-origin allow-forms"
```

```typescript
export interface IframeWidgetConfig {
  iframe: string;
  title?: string;
  flex?: number;
  height?: string;
  aspect_ratio?: string;
  sandbox?: string;
  allow?: string;
}
```

### Validation

- `iframe`: required, must pass `validateSafeUrl` (https always; http only
  for localhost/127.0.0.1/[::1]).
- `aspect_ratio`: if present, must match `^\d+\/\d+$`.
- `height`: if present, valid CSS length (`\d+(px|rem|em|vh|%)`).
- `sandbox`: if present, space-separated list of valid sandbox tokens.
  Invalid tokens stripped with a warning at config load.
- `allow`: if present, non-empty string (Permissions-Policy features).

## Behavior

- No adapter, no DB, no transforms.
- Iframe does NOT reload on panel refresh — only on full page load.
  Embedded dashboards manage their own refresh cycles.
- **X-Frame-Options denial**: if the target refuses framing, the browser
  shows its native blocked message. No special detection (requires JS).

### Security defaults

| Attribute | Default |
|-----------|---------|
| `sandbox` | `"allow-scripts allow-same-origin"` (blocks top-nav, popups, form-to-parent) |
| `referrerpolicy` | `"no-referrer"` (always) |
| `loading` | `"lazy"` |

No server-side CSP changes needed. If operators add CSP headers, they must
whitelist iframe targets themselves.

## Visual behavior

- New component: `src/layout/iframe-widget.tsx`
- Sizing priority: `height` > `aspect_ratio` > default `16/9`.
- Iframe fills 100% of its container. Border: none.
- If `title` is set, renders a `.panel-header` (same as panels, no refresh button).
- Loading indicator: CSS background animation on the container, covered by
  the iframe once it renders.
- Responsive: aspect-ratio adapts to container width; explicit heights stay fixed.

## Preset integration

Propose a new **`config.ops-dashboard.yaml`** preset:

```yaml
adapters:
  - type: rss
    params:
      urls:
        - https://www.githubstatus.com/history.rss
        - https://status.cloud.google.com/feed.atom
    refresh_interval: 15

layout:
  direction: row
  children:
    - iframe: https://grafana.example.com/d/overview
      title: System Metrics
      flex: 2
      aspect_ratio: "21/9"
    - direction: column
      flex: 1
      children:
        - panel: Status Feeds
          source: rss
          limit: 15
        - iframe: https://status.example.com/embed
          title: Uptime
          height: "300px"
```

Other documented examples: YouTube live embed, CI pipeline dashboard, wttr.in weather.

## Out of scope

- JS-based resize observers or intersection observers.
- Error detection for X-Frame-Options denial.
- Iframe-to-parent communication (postMessage).
