import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { warnUrlParseFailure } from "./utils-warn";

describe("utils warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("warnUrlParseFailure uses context:label failed for url: detail contract", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnUrlParseFailure("dedupe", "normalizeUrl", "not a url", "Invalid URL");
    expect(warnSpy).toHaveBeenCalledWith(
      'dedupe: normalizeUrl failed for "not a url": Invalid URL',
    );
  });

  test("warnUrlParseFailure preserves caller warn context (layout safeUrl)", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnUrlParseFailure("layout", "safeUrl", "bad://", "protocol issue");
    expect(warnSpy).toHaveBeenCalledWith(
      'layout: safeUrl failed for "bad://": protocol issue',
    );
  });
});