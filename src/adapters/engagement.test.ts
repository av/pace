import { describe, expect, test } from "bun:test";
import {
  extractEngagementScore,
  extractScore,
  formatComments,
  formatDiscuss,
  formatPoints,
  joinBodyParts,
  parseFirstIntMatch,
  RE_POINTS_OR_UPVOTES,
} from "./engagement";

describe("engagement format helpers", () => {
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

describe("engagement parse helpers", () => {
  test("parseFirstIntMatch uses shared points/upvotes pattern", () => {
    expect(parseFirstIntMatch("Upvote • 215 points", RE_POINTS_OR_UPVOTES)).toBe(215);
    expect(parseFirstIntMatch("42 upvotes here", RE_POINTS_OR_UPVOTES)).toBe(42);
  });

  test("extractScore and extractEngagementScore share primary patterns", () => {
    expect(extractScore("42 points | 10 comments")).toBe(42);
    expect(extractEngagementScore("42 points | 10 comments")).toBe(42 + 5);
  });
});