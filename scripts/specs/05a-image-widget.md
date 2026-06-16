# Phase 5a — Image widget

Depends on: `05-widget-infrastructure.md` (shared union, guards, dispatch).

## Context

Dashboards need purely visual elements — logos, status badges, chart images
from external services, separator graphics. These don't produce ContentItems
and don't map to the adapter model. The image widget renders a single `<img>`
at a given URL.

## Configuration

```yaml
layout:
  direction: row
  children:
    - image: https://status.example.com/badge.svg
      alt: "Service status"
      flex: 0.3

    - image: https://example.com/banner.png
      alt: "Dashboard banner"
      object_fit: contain
      max_height: "200px"
      link: https://example.com
```

```typescript
export interface ImageWidgetConfig {
  image: string;
  alt?: string;
  flex?: number;
  object_fit?: "cover" | "contain" | "fill" | "none";
  max_height?: string;
  link?: string;
}
```

### Validation

- `image`: required, non-empty string (no scheme restriction — browsers
  handle `<img src>` safely regardless of scheme).
- `object_fit`: if present, one of the four enum values.
- `max_height`: if present, valid CSS length value.
- `link`: if present, must pass `validateSafeUrl` (https or http://localhost
  only). This is the security-critical field — `<a href="javascript:...">` is
  an XSS vector.

## Behavior

- No adapter, no DB, no transforms, no refresh cycle.
- Rendered server-side as a static `<img>` tag.
- Browser fetches the image on page load. Dynamic images (badge SVGs) refresh
  naturally via HTTP caching.
- Broken URL → browser shows alt text. No server-side error.
- No CORS concern for `<img>` tags.

## Visual behavior

- New component: `src/layout/image-widget.tsx`
- Renders inside a `flex-panel` div (same as panels, for consistent spacing).
- Image uses `object-fit` (default: `contain`), `max-width: 100%`,
  `max-height: 100%`, `loading="lazy"`.
- If `link` is set, wraps in `<a target="_blank" rel="noopener noreferrer">`.
- If `max_height` is set, constrains the container.
- No panel header, no refresh button, no scrollable body.
- Accessibility: `alt` attribute (empty string = decorative image).

## Preset examples

| Preset | Use |
|--------|-----|
| `release-tracker` | CI badge: `image: https://github.com/oven-sh/bun/actions/workflows/ci.yml/badge.svg` with `link` to actions page |
| `ml-ai` | Logo banner: HuggingFace/OpenAI logo with link |
| `tech-news` | Small dashboard identifier badge at top, `flex: 0`, `max_height: "40px"` |

## Out of scope

- Image hosting/upload (URL-only).
- Image proxy or caching layer.
- Video/audio embeds.
