import { describe, expect, test } from "bun:test";
import {
  extractEngagementScore,
  extractScore,
  formatComments,
  formatCommunity,
  formatCount,
  formatCover,
  formatDiscuss,
  formatAtHandle,
  formatMedia,
  formatPercent,
  formatPoints,
  formatAnswers,
  formatBy,
  formatCategories,
  formatLeadIn,
  formatPrefixed,
  formatScore,
  formatSlashPrefixed,
  formatStars,
  formatSubreddit,
  formatTags,
  formatViews,
  parseFirstIntMatch,
  RE_POINTS_OR_UPVOTES,
} from "./engagement";

import { joinTitle } from "./title";

describe("engagement body roundtrips", () => {
  test("score-bearing bodies parse via extractScore and extractEngagementScore", () => {
    const hnBody = joinTitle(formatPoints(42), formatComments(10));
    expect(extractScore(hnBody)).toBe(42);
    expect(extractEngagementScore(hnBody)).toBe(42 + 5);

    expect(extractScore(formatScore(77))).toBe(77);
    expect(extractEngagementScore(formatStars(99))).toBe(99);
  });

  test("joinTitle preserves pipe-separated adapter layout", () => {
    const body = joinTitle(
      formatPoints(42),
      "by alice",
      formatComments(10),
      formatDiscuss("https://ex.com/talk"),
    );
    expect(body).toBe("42 points | by alice | 10 comments | discuss: https://ex.com/talk");
    expect(extractScore(body)).toBe(42);
    expect(extractEngagementScore(body)).toBe(47);
  });
});

describe("engagement display helpers", () => {
  test("formatCount backs count-bearing display helpers", () => {
    expect(formatCount(42, "points")).toBe("42 points");
    expect(formatPoints(42)).toBe("42 points");
    expect(formatComments(10)).toBe("10 comments");
    expect(formatStars(1_500)).toBe("1,500 stars");
    expect(formatAnswers(3)).toBe("3 answers");
    expect(formatAnswers(1, true)).toBe("1 answers (accepted)");
    expect(formatViews(1_000)).toBe("1.0k views");
  });

  test("formatLeadIn backs space-prefixed display helpers", () => {
    expect(formatLeadIn("by", "alice")).toBe("by alice");
    expect(formatBy("bob")).toBe("by bob");
    expect(formatBy("@carol")).toBe("by @carol");
  });

  test("formatPrefixed backs colon-prefixed display helpers", () => {
    expect(formatPrefixed("discuss", "https://ex.com/talk")).toBe("discuss: https://ex.com/talk");
    expect(formatDiscuss("https://ex.com/talk")).toBe("discuss: https://ex.com/talk");
    expect(formatPrefixed("language", "TypeScript")).toBe("language: TypeScript");
    expect(formatPrefixed("site", "https://ex.com")).toBe("site: https://ex.com");
    expect(formatScore(77)).toBe("Score: 77");
    expect(formatCategories(["cs.LG", "cs.AI"])).toBe("Categories: cs.LG, cs.AI");
  });

  test("formatPercent rounds fractional scores for npm-style bodies", () => {
    expect(formatPercent(0.806)).toBe("81%");
    expect(formatPercent(0)).toBe("0%");
  });

  test("formatViews scales large view counts", () => {
    expect(formatViews(1_500_000)).toBe("1.5m views");
    expect(formatViews(42_500)).toBe("42.5k views");
    expect(formatViews(500)).toBe("500 views");
  });

  test("formatCover and formatTags omit empty values", () => {
    expect(formatCover(null)).toBeUndefined();
    expect(formatCover("")).toBeUndefined();
    expect(formatCover("https://example.com/cover.jpg")).toBe(
      "cover: https://example.com/cover.jpg",
    );
    expect(formatTags([])).toBeUndefined();
    expect(formatTags(["typescript"])).toBe("tags: typescript");
  });

  test("formatAtHandle normalizes local, remote, and prefixed handles", () => {
    expect(formatAtHandle("alice", "social.example")).toBe("@alice@social.example");
    expect(formatAtHandle("bob@remote.social", "social.example")).toBe("@bob@remote.social");
    expect(formatAtHandle("carol")).toBe("@carol");
    expect(formatAtHandle("@dave")).toBe("@dave");
    expect(formatBy(formatAtHandle("eve"))).toBe("by @eve");
    expect(formatMedia([])).toBeUndefined();
    expect(formatMedia(["https://ex.com/a.png"])).toBe("media: https://ex.com/a.png");
  });

  test("formatSlashPrefixed backs slash-prefixed display helpers", () => {
    expect(formatSlashPrefixed("c", "technology")).toBe("c/technology");
    expect(formatSlashPrefixed("r", "programming")).toBe("r/programming");
    expect(formatCommunity("technology")).toBe("c/technology");
    expect(formatSubreddit("programming")).toBe("r/programming");
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
});

describe("extractEngagementScore", () => {
  test("returns 0 for null, empty, or whitespace-only body", () => {
    expect(extractEngagementScore(null)).toBe(0);
    expect(extractEngagementScore("")).toBe(0);
    expect(extractEngagementScore("   \t")).toBe(0);
    expect(extractEngagementScore(undefined as unknown as string | null)).toBe(0);
  });

  test("parses primary signals: points, score, upvotes, boosts, stars, likes", () => {
    expect(extractEngagementScore("10 points")).toBe(10);
    expect(extractEngagementScore("score: 42")).toBe(42);
    expect(extractEngagementScore("7 upvotes")).toBe(7);
    expect(extractEngagementScore("3 boosts")).toBe(3);
    expect(extractEngagementScore("5 stars")).toBe(5);
    expect(extractEngagementScore("12 likes")).toBe(12);
  });

  test("parses favorites with both spellings (favou?rites)", () => {
    expect(extractEngagementScore("4 favorites")).toBe(4);
    expect(extractEngagementScore("4 favourites")).toBe(4);
    expect(extractEngagementScore("9 FAVOURITES")).toBe(9);
  });

  test("parses comments as half-value (floor)", () => {
    expect(extractEngagementScore("10 comments")).toBe(5);
    expect(extractEngagementScore("1 comment")).toBe(0);
    expect(extractEngagementScore("3 comments")).toBe(1);
  });

  test("sums multiple different signals in one body", () => {
    expect(extractEngagementScore("20 points + 5 upvotes, 10 comments")).toBe(20 + 5 + 5);
    expect(extractEngagementScore("score: 100, 8 likes, 4 stars")).toBe(100 + 8 + 4);
  });

  test("ignores non-matching text and non-numeric", () => {
    expect(extractEngagementScore("no numbers here at all")).toBe(0);
    expect(extractEngagementScore("points: lots")).toBe(0);
    expect(extractEngagementScore("42")).toBe(0);
  });

  test("case-insensitive and trims around numbers", () => {
    expect(extractEngagementScore("  99 POINTS  ")).toBe(99);
    expect(extractEngagementScore("2 boosts")).toBe(2);
  });

  test("weights comments on pipe-separated adapter bodies", () => {
    const body = "42 points | 10 comments";
    expect(extractScore(body)).toBe(42);
    expect(extractEngagementScore(body)).toBe(42 + 5);
  });
});