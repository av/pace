import { describe, test, expect, spyOn, afterEach } from "bun:test";
import {
  warnAdapter,
  warnDateParseFallback,
  warnEmptyConfig,
  warnEmptyFeedEntries,
  warnEmptyFetchResult,
  warnEmptySection,
  warnFilterRemovedAll,
  warnIneffectiveParam,
  warnInvalidInput,
  warnMalformedArrayField,
  warnMalformedFeedField,
  warnOptionalFetchFailure,
} from "./adapters/empty-config";

describe("adapter warn utilities", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("warnAdapter prefixes message with adapter name", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnAdapter("github", "custom operational warning");
    expect(warnSpy).toHaveBeenCalledWith("github: custom operational warning");
  });

  test("warnEmptyConfig warns with adapter prefix and returns empty array", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    expect(warnEmptyConfig("rss", "no urls configured")).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith("rss: no urls configured");
  });

  test("warnIneffectiveParam describes param/requirement dependency", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnIneffectiveParam("producthunt", "min_upvotes", "enrich: true");
    expect(warnSpy).toHaveBeenCalledWith(
      "producthunt: min_upvotes has no effect without enrich: true",
    );
  });

  test("warnInvalidInput describes invalid user input", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnInvalidInput("mastodon", "account handle", "not-a-handle");
    expect(warnSpy).toHaveBeenCalledWith("mastodon: invalid account handle: not-a-handle");
  });

  test("warnEmptyFetchResult describes empty fetch results", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnEmptyFetchResult("github", "repos", "trending page");
    expect(warnSpy).toHaveBeenCalledWith("github: no repos found on trending page");
  });

  test("warnEmptySection describes absent or empty payload sections", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnEmptySection("wikipedia", "featured feed", "most_read articles (en)");
    expect(warnSpy).toHaveBeenCalledWith(
      "wikipedia: featured feed has no most_read articles (en)",
    );
  });

  test("warnFilterRemovedAll describes filter removing every item", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnFilterRemovedAll("producthunt", "min_upvotes", 100, 2, "enriched item(s)");
    expect(warnSpy).toHaveBeenCalledWith(
      "producthunt: min_upvotes (100) filtered all 2 enriched item(s)",
    );
  });

  test("warnMalformedArrayField describes malformed JSON array fields", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnMalformedArrayField("reddit", "children", "r/test", "got string");
    expect(warnSpy).toHaveBeenCalledWith(
      'reddit: expected array field "children" for r/test (got string), treating as empty',
    );
  });

  test("warnMalformedFeedField describes malformed feed item/entry fields", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnMalformedFeedField("rss", "item", "bad feed", "got string");
    expect(warnSpy).toHaveBeenCalledWith(
      'rss: expected feed field "item" for bad feed (got string), treating as empty',
    );
  });

  test("warnEmptyFeedEntries describes legitimately empty feeds", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnEmptyFeedEntries("podcast", "https://example.com/empty.xml");
    expect(warnSpy).toHaveBeenCalledWith(
      "podcast: no entries found in https://example.com/empty.xml",
    );
  });

  test("warnDateParseFallback describes date parsing fallbacks", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnDateParseFallback("invalid feed date", '"not-a-date"');
    expect(warnSpy).toHaveBeenCalledWith(
      'dates: invalid feed date "not-a-date", using current time',
    );
  });

  test("warnOptionalFetchFailure prefixes context and detail on failure", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnOptionalFetchFailure("mastodon", new Error("network down"), "account lookup");
    expect(warnSpy).toHaveBeenCalledWith("mastodon: account lookup: network down");
  });

  test("warnOptionalFetchFailure passes through errors already prefixed with adapter name", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnOptionalFetchFailure(
      "producthunt",
      new Error("producthunt: failed to fetch https://example.com: HTTP error 404"),
      "enrich failed",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "producthunt: failed to fetch https://example.com: HTTP error 404",
    );
  });
});