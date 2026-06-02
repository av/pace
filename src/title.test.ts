import { describe, expect, test } from "bun:test";
import {
  joinTitle,
  joinTitleWithTagline,
  titleWithTagline,
  truncateForTitle,
} from "./adapters/title";

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

describe("joinTitleWithTagline", () => {
  test("returns primary when tagline and extras absent", () => {
    expect(joinTitleWithTagline("repo/name")).toBe("repo/name");
  });

  test("truncates tagline and joins extra segments", () => {
    const tagline = "d".repeat(150);
    const title = joinTitleWithTagline("owner/repo", tagline, 100, "+10 today");
    expect(title.startsWith("owner/repo | ")).toBe(true);
    expect(title.endsWith("+10 today")).toBe(true);
    expect(title.length).toBe("owner/repo | ".length + 100 + " | +10 today".length);
  });

  test("matches titleWithTagline when no extras", () => {
    expect(joinTitleWithTagline("A", "tag", 50)).toBe(titleWithTagline("A", "tag", 50));
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