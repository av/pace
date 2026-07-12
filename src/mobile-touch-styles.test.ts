import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");

function refreshButtonRule(css: string): string {
  const match = css.match(/\.refresh-btn\s*\{([^}]*)\}/s);
  expect(match).not.toBeNull();
  return match![1];
}

describe("refresh button pointer sizing", () => {
  test("coarse pointers get a 44 by 44 pixel minimum touch target", () => {
    const coarseStart = styles.indexOf("@media (pointer: coarse)");
    expect(coarseStart).toBeGreaterThan(-1);
    const coarseRule = refreshButtonRule(styles.slice(coarseStart));

    expect(coarseRule).toContain("min-width: 44px");
    expect(coarseRule).toContain("min-height: 44px");
  });

  test("fine-pointer default remains compact", () => {
    const defaultRule = refreshButtonRule(styles);
    expect(defaultRule).not.toContain("min-width");
    expect(defaultRule).not.toContain("min-height");
  });
});
