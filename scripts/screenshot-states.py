#!/usr/bin/env python
"""Capture keyboard-interaction UI states of a running pace dashboard.

scripts/screenshot-presets.sh only captures the dashboard at rest, which
misses the states that exist purely behind interaction: the :focus-visible
ring on item links and refresh buttons, the "?" keyboard-help overlay, and
(when an iframe panel is present) the loading stripe behind a slow embed.
This script drives those states with real keyboard events through Playwright
(the same Python Playwright install that backs the `playwright` CLI the
presets script uses) so theme/contrast regressions in them are catchable.

Usage:
    scripts/screenshot-states.py <url> <output-prefix>

Example (against a locally served preset):
    PACE_DB_PATH=$(mktemp -d)/pace.db bun run src/cli.ts serve -p 17971 -P daily-brief &
    scripts/screenshot-states.py http://127.0.0.1:17971/ /tmp/daily

Writes <prefix>-rest.png, <prefix>-focus.png, <prefix>-focus-zoom.png,
<prefix>-help.png, and <prefix>-refresh-focus.png.

Note: headless Chromium on Linux does not paint scrollbars into screenshots
(overlay scrollbars are skipped by the compositor), so the themed thin
scrollbars from styles.css cannot be verified this way; check their computed
scrollbar-color instead.
"""

import sys

from playwright.sync_api import sync_playwright

VIEWPORT = {"width": 1440, "height": 900}


def clip_around(rect, pad):
    return {
        "x": max(rect["x"] - pad, 0),
        "y": max(rect["y"] - pad, 0),
        "width": min(rect["w"] + 2 * pad, VIEWPORT["width"]),
        "height": rect["h"] + 2 * pad,
    }


def main():
    if len(sys.argv) != 3:
        print(__doc__.strip().splitlines()[0])
        print("usage: scripts/screenshot-states.py <url> <output-prefix>")
        return 2
    url, prefix = sys.argv[1], sys.argv[2]

    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.goto(url)
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{prefix}-rest.png")

        # Focus ring: "j" makes dashboard.js focus the first item link from a
        # real keyboard event, which is what arms Chromium's :focus-visible.
        page.keyboard.press("j")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{prefix}-focus.png")
        el = page.evaluate(
            """() => {
              const a = document.activeElement;
              if (!a || a.tagName !== 'A') return null;
              const r = a.getBoundingClientRect();
              return {x: r.x, y: r.y, w: r.width, h: r.height};
            }"""
        )
        if el:
            page.screenshot(path=f"{prefix}-focus-zoom.png", clip=clip_around(el, 30))
        else:
            failures.append("no item link took focus on 'j' (dashboard.js not active?)")

        # Help overlay ("?"), closed again with Escape.
        page.keyboard.press("?")
        page.wait_for_timeout(300)
        visible = page.evaluate(
            "() => { const d = document.querySelector('.kbd-help'); return d ? !d.hidden : null; }"
        )
        page.screenshot(path=f"{prefix}-help.png")
        if not visible:
            failures.append("'?' did not open the .kbd-help overlay")
        page.keyboard.press("Escape")

        # Refresh-button focus ring (focus moved during keydown handling keeps
        # :focus-visible armed in Chromium).
        ref = page.evaluate(
            """() => {
              const b = document.querySelector('.refresh-btn');
              if (!b) return null;
              b.focus();
              const r = b.getBoundingClientRect();
              return {x: r.x, y: r.y, w: r.width, h: r.height};
            }"""
        )
        page.wait_for_timeout(200)
        if ref:
            page.screenshot(path=f"{prefix}-refresh-focus.png", clip=clip_around(ref, 40))
        browser.close()

    for failure in failures:
        print(f"warning: {failure}", file=sys.stderr)
    print(f"saved {prefix}-{{rest,focus,focus-zoom,help,refresh-focus}}.png")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
