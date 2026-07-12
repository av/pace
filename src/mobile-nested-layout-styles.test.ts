import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");
const mobileStart = styles.indexOf("@media (max-width: 768px)");
const nextMedia = styles.indexOf("@media", mobileStart + 1);
const mobile = styles.slice(mobileStart, nextMedia);
const desktop = styles.slice(0, mobileStart);

describe("deep nested mobile layout scrolling", () => {
  test("mobile stacks natural-height containers and delegates scrolling to the page", () => {
    expect(mobileStart).toBeGreaterThan(-1);
    expect(mobile).toContain("flex-direction: column !important");
    expect(mobile).toContain("height: auto");
    expect(mobile).toContain("overflow: visible");
    expect(mobile).toContain("flex: none !important");
    expect(mobile).toContain(".flex-panel > .panel > .panel-body");
  });

  test("desktop keeps the fixed canvas and internal panel scrolling", () => {
    expect(desktop).toMatch(/body\s*\{[^}]*height: 100%[^}]*overflow: hidden/s);
    expect(desktop).toMatch(/\.flex-root\s*\{[^}]*height: 100%/s);
    expect(desktop).toMatch(/\.flex-panel > \.panel > \.panel-body,[^{]*\{[^}]*overflow-y: auto/s);
  });
});
