import { describe, expect, test } from "bun:test";
import { joinTitle, titleWithTagline, truncateForTitle } from "./adapters/title";

describe("joinTitle", () => {
  test("joins non-empty trimmed parts", () => {
    expect(joinTitle("a", "b", "c")).toBe("a | b | c");
  });

  test("skips empty and null parts", () => {
    expect(joinTitle("a", "", null, undefined, "  ", "b")).toBe("a | b");
  });
});

describe("truncateForTitle", () => {
  test("leaves short text unchanged", () => {
    expect(truncateForTitle("hello")).toBe("hello");
  });

  test("truncates with ellipsis", () => {
    const long = "x".repeat(120);
    expect(truncateForTitle(long, 100).length).toBe(100);
    expect(truncateForTitle(long, 100).endsWith("…")).toBe(true);
  });
});

describe("titleWithTagline", () => {
  test("returns primary when tagline missing", () => {
    expect(titleWithTagline("Release 1.0", "")).toBe("Release 1.0");
    expect(titleWithTagline("Release 1.0", null)).toBe("Release 1.0");
  });

  test("joins and truncates tagline by default", () => {
    const tagline = "d".repeat(150);
    const title = titleWithTagline("owner/repo: v1", tagline);
    expect(title.startsWith("owner/repo: v1 | ")).toBe(true);
    expect(title.length).toBe("owner/repo: v1 | ".length + 100);
  });

  test("maxTagline 0 skips truncation", () => {
    const tagline = "d".repeat(150);
    expect(titleWithTagline("Product", tagline, 0)).toBe(`Product | ${tagline}`);
  });
});