import { describe, test, expect, spyOn, afterEach } from "bun:test";
import {
  warnTransform,
  warnInvalidHalfLife,
  warnInvalidKeywordScoreRegex,
  warnUnknownTransformType,
  warnUnknownDedupeStrategy,
} from "./transform-warn";

describe("transform warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
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