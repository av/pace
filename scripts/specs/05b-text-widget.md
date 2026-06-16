# Phase 5b — Text widget

Depends on: `05-widget-infrastructure.md` (shared union, guards, dispatch).

## Context

There's no way to place static content — notes, instructions, changelogs — in
the dashboard without creating a dummy adapter. The text widget renders
user-provided content inline, supporting plain text, Markdown, and sanitized
HTML.

## Configuration

```yaml
layout:
  direction: row
  children:
    - text: "Welcome to the dashboard."

    - text: |
        ## Changelog
        - **v0.5** — video/podcast preset
        - **v0.4** — LLM summaries
      format: markdown
      title: Updates

    - text: "<em>Status:</em> all systems operational"
      format: html
      title: Status
```

```typescript
export interface TextWidgetConfig {
  text: string;
  format?: "plain" | "markdown" | "html";
  title?: string;
  flex?: number;
}
```

### Validation

- `text`: required, non-empty string.
- `format`: if present, one of the three enum values. Default: `"plain"`.
- `title`: optional non-empty string.
- `flex`: optional positive number.

## Behavior

- No adapter, no DB, no transforms, no refresh.
- Content is inline in config only. No file-path support (out of scope).
- Rendered server-side at template time.

### Markdown rendering

Use `marked` (MIT, ~55 kB, zero native deps) with GFM enabled.
Server-side only — no client JS.

### HTML sanitization

**Critical for security.** Both `format: "html"` and rendered Markdown output
must be sanitized before embedding. Use `sanitize-html` (MIT, works in Bun
without jsdom).

Allowlist approach:
- Tags: standard formatting (`p`, `a`, `em`, `strong`, `code`, `ul`, `ol`,
  `li`, `h1`–`h6`, `pre`, `blockquote`, `details`, `summary`, `img`).
- Attributes: `a[href, target, rel]`, `img[src, alt]`.
- Schemes: `https`, `http` only.
- Strip: `<script>`, event handlers, `javascript:` URIs.

For `format: "plain"`: render as text content (Hono's JSX escapes
automatically). No sanitization library needed.

### New dependencies

- `marked` (production)
- `sanitize-html` (production)

## Visual behavior

- New component: `src/layout/text-widget.tsx`
- Wrapped in `.flex-panel > .panel.text-widget` for consistent card appearance.
- If `title` is set, renders a `.panel-header` with `<h2>` (no refresh button).
- Body scrolls vertically on overflow (`overflow-y: auto`).
- Markdown content inherits dashboard typography.
- Responsive via same flex system as panels.

## Preset examples

| Preset | Use |
|--------|-----|
| `daily-brief` | "About" note: sources, refresh cadence |
| `tech-news` | Pipeline legend: what the merged feeds do |
| `release-tracker` | Instructions: how to add repos to track |
| `academic-papers` | Markdown table of arXiv category codes |

## Out of scope

- File-path content source (`file: ./notes.md`).
- Widget-level refresh (re-reading a file on interval).
- Client-side Markdown rendering or live editing.
