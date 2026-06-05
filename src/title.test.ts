import { describe, expect, test } from "bun:test";
import {
  capText,
  joinTitle,
  joinTitleWithTagline,
  truncateForTitle,
  truncateText,
} from "./adapters/title";

describe("joinTitle", () => {
  test("joins non-empty trimmed parts", () => {
    expect(joinTitle("a", "b", "c")).toBe("a | b | c");
  });

  test("skips empty and null parts", () => {
    expect(joinTitle("a", "", null, undefined, "  ", "b")).toBe("a | b");
  });
});

describe("capText", () => {
  test("returns input when within max", () => {
    expect(capText("hello", 10)).toBe("hello");
  });

  test("caps without ellipsis", () => {
    expect(capText("long body content", 10)).toBe("long body ");
  });
});

describe("truncateText", () => {
  test("exclusive mode appends ASCII ellipsis after content max", () => {
    const long = "word ".repeat(120).trim();
    const truncated = truncateText(long, 300, {
      ellipsis: "...",
      inclusive: false,
      trim: false,
    });
    expect(truncated.endsWith("...")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(303);
    expect(truncated).not.toBe(long);
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
    const prefix = "owner/repo | ";
    const suffix = " | +10 today";
    const taglinePart = title.slice(prefix.length, title.length - suffix.length);
    expect(taglinePart.length).toBe(100);
    expect(taglinePart.endsWith("…")).toBe(true);
    expect(title).toBe(`${prefix}${taglinePart}${suffix}`);
  });

  test("returns primary when tagline missing", () => {
    expect(joinTitleWithTagline("Release 1.0", "")).toBe("Release 1.0");
    expect(joinTitleWithTagline("Release 1.0", null)).toBe("Release 1.0");
  });

  test("joins and truncates tagline by default", () => {
    const tagline = "d".repeat(150);
    const title = joinTitleWithTagline("owner/repo: v1", tagline);
    const prefix = "owner/repo: v1 | ";
    const taglinePart = title.slice(prefix.length);
    expect(taglinePart.length).toBe(100);
    expect(taglinePart.endsWith("…")).toBe(true);
    expect(title).toBe(`${prefix}${taglinePart}`);
  });

  test("maxTagline 0 skips truncation", () => {
    const tagline = "d".repeat(150);
    expect(joinTitleWithTagline("Product", tagline, 0)).toBe(`Product | ${tagline}`);
  });
});