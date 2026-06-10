import { describe, test, expect, spyOn, afterEach } from "bun:test";
import {
  formatTransformDedupeRemovedLine,
  logTransform,
  logTransformDedupeRemoved,
  logTransformDetail,
  logTransformMinScoreFiltered,
  logTransformClusterSummary,
  warnTransform,
  warnInvalidHalfLife,
  warnInvalidKeywordScoreRegex,
  warnUnknownTransformType,
  warnUnknownDedupeStrategy,
} from "./transform-warn";

describe("transform warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
    logSpy?.mockRestore();
  });

  test("logTransform prefixes message with transforms module name", () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});

    logTransform("keyword-score scored 3 items, 2 passed");
    expect(logSpy).toHaveBeenCalledWith(
      "transforms: keyword-score scored 3 items, 2 passed",
    );
  });

  test("formatTransformDedupeRemovedLine includes winner when provided", () => {
    const loser = { title: "Old post", url: "https://example.com/old" };
    const winner = { title: "New post" };

    expect(formatTransformDedupeRemovedLine(loser)).toBe(
      '"Old post" (https://example.com/old)',
    );
    expect(formatTransformDedupeRemovedLine(loser, winner)).toBe(
      '"Old post" (https://example.com/old) -> kept "New post"',
    );
  });

  test("logTransformDetail emits indented line without module prefix", () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});

    logTransformDetail("- duplicate item");
    expect(logSpy).toHaveBeenCalledWith("  - duplicate item");
  });

  test("logTransformDedupeRemoved caps detail lines and reports overflow", () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});

    logTransformDedupeRemoved(
      "url",
      Array.from({ length: 12 }, (_, i) => `item-${i}`),
      " (threshold=0.8)",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "transforms: dedupe:url removed 12 duplicate(s) (threshold=0.8):",
    );
    expect(logSpy).toHaveBeenCalledWith("  - item-0");
    expect(logSpy).toHaveBeenCalledWith("  - item-9");
    expect(logSpy).not.toHaveBeenCalledWith("  - item-10");
    expect(logSpy).toHaveBeenCalledWith("  ... and 2 more");
  });

  test("logTransformClusterSummary describes strategy, clusters, and unclustered count", () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});

    logTransformClusterSummary("auto", [{ label: "GitHub", indices: [0, 1] }], 0);
    expect(logSpy).toHaveBeenCalledWith(
      'transforms: cluster strategy=auto, 1 cluster(s): "GitHub" (2 items), 0 unclustered',
    );
  });

  test("logTransformMinScoreFiltered describes filtered count and threshold", () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});

    logTransformMinScoreFiltered("time-decay", 2, 0.5);
    expect(logSpy).toHaveBeenCalledWith(
      "transforms: time-decay filtered out 2 item(s) below min_score=0.5",
    );
  });

  test("warnTransform prefixes message with transforms module name", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnTransform("custom operational warning");
    expect(warnSpy).toHaveBeenCalledWith("transforms: custom operational warning");
  });

  test("warnInvalidHalfLife describes fallback for unparseable half_life", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnInvalidHalfLife("bad-unit", "12h");
    expect(warnSpy).toHaveBeenCalledWith(
      'transforms: invalid half_life "bad-unit", defaulting to 12h',
    );
  });

  test("warnInvalidKeywordScoreRegex includes regex term and error detail", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnInvalidKeywordScoreRegex("[unclosed", new SyntaxError("Invalid regular expression"));
    expect(warnSpy).toHaveBeenCalledWith(
      'transforms: invalid keyword-score regex "[unclosed": Invalid regular expression, treating as literal',
    );
  });

  test("warnUnknownTransformType describes skipped unknown pipeline step", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnUnknownTransformType("nonexistent");
    expect(warnSpy).toHaveBeenCalledWith(
      'transforms: unknown transform type "nonexistent", skipping',
    );
  });

  test("warnUnknownDedupeStrategy describes pass-through on bad strategy", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnUnknownDedupeStrategy("weird");
    expect(warnSpy).toHaveBeenCalledWith(
      'transforms: unknown dedupe strategy "weird", passing items through',
    );
  });
});