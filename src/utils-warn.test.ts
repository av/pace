import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { warnUrlParseFailure } from "./utils-warn";

describe("utils warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("warnUrlParseFailure uses context: cannot parse URL for purpose contract", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnUrlParseFailure("dedupe", "normalization", "not a url", "Invalid URL");
    expect(warnSpy).toHaveBeenCalledWith(
      'dedupe: cannot parse URL "not a url" for normalization: Invalid URL',
    );
  });

  test("warnUrlParseFailure preserves caller warn context (layout safeUrl)", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnUrlParseFailure("layout", "dashboard link", "bad://", "protocol issue");
    expect(warnSpy).toHaveBeenCalledWith(
      'layout: cannot parse URL "bad://" for dashboard link: protocol issue',
    );
  });
});