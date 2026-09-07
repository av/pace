# Overlay controls integration tests

## Prerequisites

- Run from the Pace repository with Bun and Playwright Chromium installed.
- Use a fresh temporary directory for the config, SQLite DB, screenshots and browser scripts. Never use a deployed DB.
- Create a fixture RSS feed with at least three distinct stories, and serve it on an unused localhost port. Configure an RSS adapter named `fixture` and a panel `{ panel: News, id: news, source: all }`.
- Start `PACE_DB_PATH=<temporary-db> PORT=18111 bun run src/cli.ts --config <absolute-fixture-config> serve`. Wait for `/health`, POST `/refresh/news`, then poll `/api/panels/news` until items appear.
- Browser contexts must start with empty localStorage and service-worker state. Use 1440×900 desktop and 390×844 mobile (`is_mobile: true`, `has_touch: true`). Record the exact commit under test.

## Desktop hover and keyboard

1. Load `/` and move the mouse outside all items and the toolbar. Every `.item-seen-btn`, `.item-star-btn` and `.page-toolbar > .refresh-btn` has computed opacity `0` and pointer-events `none`.
2. Hover the first item: both controls have opacity `1` and pointer-events `auto`; other items stay hidden. Click star, then move the pointer outside the item without blurring or moving focus: both controls return to opacity `0` and pointer-events `none`. Repeat hover, click theme, pointer exit on the toolbar: all its controls hide despite the clicked button retaining focus.
3. Focus an item title using Tab or `j`: its controls reveal. Focus `.page-toolbar` and Tab through its buttons: controls remain visible and have non-empty accessible labels.
4. Click seen and star. Their `aria-pressed` values become `true`; GET `/api/seen` and `/api/star` include the item's `data-seen-key`. Move the mouse and focus elsewhere: pressed controls still hide. Reload and verify persisted marks.
5. Every action button contains a decorative SVG with `aria-hidden=true`, `focusable=false`, and a 24×24 viewBox. No Unicode glyph substitutes remain in item, panel or toolbar buttons.
6. Exercise collapse/expand, theme, hide seen, starred-only, filter, help and refresh. Assert the corresponding panel class/ARIA state, root theme, body filter classes, filter visibility, help visibility and successful refresh response.

## Touch

1. At rest, item and toolbar icons remain hidden. Tap non-link space in an item: its controls reveal and focus is on that item; no navigation or seen/star mutation occurs.
2. Tap star and seen: each performs exactly its own action. Both bounding rectangles are at least 44×44 CSS pixels and do not intersect.
3. Tap outside the item: its controls hide. Tap a story title from idle: normal link navigation still works without requiring a reveal tap.
4. Tap the quiet top-right toolbar surface: icons reveal with no action triggered. Tap theme: theme toggles. Tap outside: icons hide.

## Appearance and regression

1. Capture desktop idle/hover/focus and mobile idle/revealed screenshots in dark and light themes. Check that borders, icons and active accents are legible and controls fit within the viewport.
2. With reduced motion enabled, reveal/hide works without animation; the collapse transition is disabled.
3. Run `bun test` and `bun run typecheck`; both exit zero. Check static rendering tests still pass and static HTML contains no injected item controls or toolbar.
4. Stop only the fixture/server processes started for this test. Record CHECK, COMMAND, EXPECTED, ACTUAL and RESULT for each check, with log/screenshot paths.
