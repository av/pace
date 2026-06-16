# Phase 5d — Bookmarks adapter

Depends on: existing adapter infrastructure (no widget infra changes needed).

## Context

A common dashboard need is a curated link list — quick-access tools, reference
docs, daily links — defined directly in config rather than fetched from an API.
Implementing this as a standard adapter (`type: bookmarks`) keeps the
architecture uniform: bookmarks produce ContentItems, render in normal panels,
and participate in transforms/pipelines like any other source.

## Configuration

```yaml
adapters:
  - name: my-tools
    type: bookmarks
    params:
      items:
        - title: "Linear"
          url: "https://linear.app"
          description: "Issue tracker"
          tags: ["work", "daily"]
        - title: "Figma"
          url: "https://figma.com"
          tags: ["design"]
        - title: "ArXiv CS.LG"
          url: "https://arxiv.org/list/cs.LG/recent"

layout:
  direction: row
  children:
    - panel: "My Tools"
      source: my-tools
```

### Params

```typescript
// ADAPTER_PARAM_KEYS addition:
bookmarks: ["items"],
```

Each entry in `items`:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `title` | yes | string | Link text |
| `url` | yes | string | Target URL (http/https) |
| `description` | no | string | Shown as body/summary below title |
| `tags` | no | string[] | First tag used in source label |

### Validation

- `params.items` must be a non-empty array.
- Each item needs non-empty `title` and `url` (string).
- `url` must start with `http://` or `https://`.
- Items missing required fields are filtered out with a warning (not a hard error).

## Behavior

| Concern | Decision |
|---------|----------|
| Network | None. `fetch()` returns items directly from config params. |
| Timestamp | `new Date()` at fetch time — items sort predictably among peers. |
| Source label | `"bookmarks"` if no tags; `"bookmarks:<first-tag>"` if tagged. |
| Refresh | No-op (re-emits same items). Standard `refresh_interval` applies. |
| ID stability | `bookmarks:<slug>-<index>` — stable across refreshes for dedup. |
| Transforms | Fully compatible. Filter, score, dedup, LLM-summarize all work. |

### ContentItem mapping

| Field | Value |
|-------|-------|
| `id` | `bookmarks:<slugified-title>-<index>` |
| `title` | Item's `title` |
| `url` | Item's `url` |
| `source` | `"bookmarks"` or `"bookmarks:<first-tag>"` |
| `timestamp` | Current time |
| `body` | Item's `description` (or undefined) |

## Visual behavior

No new UI code. Renders via existing `Panel` + `ContentItemCard` components:
- Each bookmark is a clickable title link.
- `description` appears as the summary line.
- Source pill shows `bookmarks` or `bookmarks:<tag>`.
- Add `bookmarks: "src-bookmarks"` to `SOURCE_COLORS` for pill styling.

## Files

| File | Change |
|------|--------|
| `src/adapters/bookmarks.ts` | New adapter module |
| `src/adapters/params.ts` | Add `bookmarks: ["items"]` |
| `src/adapters/adapter-registry.ts` | Register adapter |
| `src/layout/panel.tsx` | Add `SOURCE_COLORS` entry |

## Preset examples

| Preset | Use |
|--------|-----|
| `daily-brief` | "My Tools" sidebar: Gmail, Calendar, Linear, etc. |
| `tech-news` | Reference links: MDN, TypeScript handbook, Node docs |
| Any | Quick-access links the user checks daily |

## Out of scope

- Fetching bookmark metadata (favicons, descriptions) from URLs.
- Import from browser bookmarks file.
- Dynamic bookmark sources (API-backed bookmark services).
