# Phase 5 — Widget infrastructure (shared across 5a–5e)

## Context

Today every leaf node in the layout tree is a `PanelConfig`. Phases 5a–5e add
five new features: three static layout widgets (image, text, iframe) and two
new adapters (bookmarks, counter). The layout widgets introduce a new category
of leaf node that has no adapter, no DB rows, and no refresh cycle.

This document defines the shared infrastructure changes needed before (or
alongside) any individual widget.

## Layout node union

The `LayoutNodeConfig` union expands to include all widget types:

```typescript
export type LayoutNodeConfig =
  | FlexContainerConfig
  | PanelConfig
  | ImageWidgetConfig
  | TextWidgetConfig
  | IframeWidgetConfig;
```

Each widget type is discriminated by a unique top-level key (`image`, `text`,
`iframe`) that cannot appear alongside `panel` or `direction`/`children`.

## Type guards

All widget guards follow the same minimal pattern — check the discriminator
key only. Validation (not the guard) enforces mutual exclusion.

```typescript
export function isImageWidget(node: unknown): node is ImageWidgetConfig {
  return isRecord(node) && "image" in node;
}
export function isTextWidget(node: unknown): node is TextWidgetConfig {
  return isRecord(node) && "text" in node;
}
export function isIframe(node: unknown): node is IframeWidgetConfig {
  return isRecord(node) && "iframe" in node;
}
```

## collectPanels

Remove the throw for unknown node types. Widgets are not panels — they return
`[]` silently. Validation already rejects truly invalid nodes at config-load
time, so the throw is defensive dead code once widgets exist.

```typescript
export function collectPanels(node: LayoutNodeConfig): PanelConfig[] {
  if (isPanel(node)) return [node];
  if (isContainer(node)) return node.children.flatMap(collectPanels);
  return [];
}
```

## Layout dispatch order (layout-node.tsx)

Single canonical order:

1. `isImageWidget` → `<ImageWidget />`
2. `isTextWidget` → `<TextWidget />`
3. `isIframe` → `<IframeWidget />`
4. `isPanel` → check `display` field for alternate renderers, else default `<Panel />`
5. `isContainer` → recurse children

## Config validation (validateLayoutNode)

Detect which discriminator key is present and route to the appropriate
validator. The discriminator keys are: `panel`, `direction`, `image`, `text`,
`iframe`. A node must have exactly one:

```
const found = ["panel", "direction", "image", "text", "iframe"]
  .filter(k => k in node);
if (found.length !== 1) → error (ambiguous or unrecognized layout node)
```

Then dispatch by the single discriminator. Container validation further
requires `children` (existing behavior); widget validators check their own
allowed keys.

## URL validation (shared)

Both image `link` and iframe `iframe` need URL scheme validation. Extract a
shared `validateSafeUrl(url, path)` that:
- Allows `https://` always
- Allows `http://` only for localhost / 127.0.0.1 / [::1]
- Rejects `javascript:`, `data:`, `ftp:`, and everything else

Reuse `safeLinkUrl` from `src/utils.ts` at render time as a defense-in-depth
second pass.

## CSS

All widget styles go into the project's static CSS file (served as
`/styles.css`). Each widget gets a scoped class (`.image-widget`,
`.text-widget`, `.iframe-panel`, `.counter-panel`) to avoid collisions.

## PanelConfig extension

Spec 5e (counter) adds `display?: "counter"` to `PanelConfig`. This is a
forward-looking union field — future display modes (`sparkline`, `gauge`)
extend it. All other specs are unaffected (existing panels omit `display`).

## Implementation order

These can be implemented in any order since the shared infrastructure (union,
guards, collectPanels, dispatch, validation routing) is a one-time commit. The
recommended approach:

1. Land shared infrastructure (this spec)
2. Image widget (simplest — no deps, no adapter)
3. Iframe widget (no deps, slightly more validation)
4. Text widget (adds `marked` + `sanitize-html` deps)
5. Bookmarks adapter (new adapter, uses existing panel rendering)
6. Counter adapter + display mode (most complex)

## Files touched by this shared spec

| File | Change |
|------|--------|
| `src/layout/domain.ts` | Union update, all type guards, `collectPanels` simplification |
| `src/layout/types.ts` | Re-export new types and guards |
| `src/layout/layout-node.tsx` | Unified dispatch |
| `src/config-validate.ts` | Discriminator routing, shared `validateSafeUrl` |
