import { describe, expect, test } from "bun:test";
import {
  extractEngagementScore,
  extractScore,
  formatComments,
  formatDiscuss,
  formatPercent,
  formatPoints,
  formatReactions,
  formatScore,
  formatStars,
  joinBodyParts,
  parseFirstIntMatch,
  RE_POINTS_OR_UPVOTES,
} from "./engagement";

describe("engagement format helpers", () => {
  test("formatScore matches extractScore score: label", () => {
    const body = formatScore(42);
    expect(body).toBe("Score: 42");
    expect(extractScore(body)).toBe(42);
  });

  test("formatReactions for devto-style bodies", () => {
    expect(formatReactions(7)).toBe("7 reactions");
  });

  test("formatPercent for npm registry fractional scores", () => {
    expect(formatPercent(0.806)).toBe("81%");
    expect(formatPercent(0)).toBe("0%");
  });

  test("formatStars for github trending bodies", () => {
    expect(formatStars(123456)).toBe("123,456 stars");
    expect(extractEngagementScore(formatStars(99))).toBe(99);
  });

  test("joinBodyParts matches adapter metadata layout", () => {
    expect(
      joinBodyParts(
        formatPoints(42),
        "by alice",
        formatComments(10),
        formatDiscuss("https://ex.com/talk"),
      ),
    ).toBe("42 points | by alice | 10 comments | discuss: https://ex.com/talk");
  });
});

describe("extractScore", () => {
  test("returns 0 for null, empty, or no matching pattern", () => {
    expect(extractScore(null)).toBe(0);
    expect(extractScore("")).toBe(0);
    expect(extractScore("just some text without scores")).toBe(0);
    expect(extractScore("points but no digit")).toBe(0);
  });

  test("extracts N from 'N points' or 'N point' variants (HN/Lobsters style)", () => {
    expect(extractScore("42 points")).toBe(42);
    expect(extractScore("The item has 123 points")).toBe(123);
    expect(extractScore("1 point")).toBe(1);
    expect(extractScore("42 points | 10 comments")).toBe(42);
  });

  test("extracts N from 'score: N' or 'Score: N' (case-insensitive)", () => {
    expect(extractScore("score: 77")).toBe(77);
    expect(extractScore("Score: 5 more text")).toBe(5);
    expect(extractScore("foo score:99 bar")).toBe(99);
  });

  test("extracts N from 'N upvotes' variants", () => {
    expect(extractScore("15 upvotes")).toBe(15);
    expect(extractScore("1000 upvotes here")).toBe(1000);
  });

  test("prefers first matching pattern in definition order: points > score > upvotes when multiple present", () => {
    expect(extractScore("10 points and score: 99")).toBe(10);
    expect(extractScore("score: 20 and 30 upvotes")).toBe(20);
    expect(extractScore("42 points, 100 upvotes")).toBe(42);
  });

  test("handles unicode text, mixed case, and embedded numbers correctly", () => {
    expect(extractScore("Café article • 42 points • 2023")).toBe(42);
    expect(extractScore("Naïve post with Score: 7")).toBe(7);
  });
});

describe("engagement parse helpers", () => {
  test("parseFirstIntMatch uses shared points/upvotes pattern", () => {
    expect(parseFirstIntMatch("Upvote • 215 points", RE_POINTS_OR_UPVOTES)).toBe(215);
    expect(parseFirstIntMatch("42 upvotes here", RE_POINTS_OR_UPVOTES)).toBe(42);
  });

  test("extractEngagementScore weights comments on pipe-separated adapter bodies", () => {
    const body = "42 points | 10 comments";
    expect(extractScore(body)).toBe(42);
    expect(extractEngagementScore(body)).toBe(42 + 5);
  });
});