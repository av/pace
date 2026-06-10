import { describe, test, expect, spyOn, afterEach } from "bun:test";
import {
  warnAdapter,
  warnEmptyConfig,
  warnEmptyFetchResult,
  warnFilterRemovedAll,
  warnIneffectiveParam,
  warnInvalidInput,
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

  test("warnFilterRemovedAll describes filter removing every item", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnFilterRemovedAll("producthunt", "min_upvotes", 100, 2, "enriched item(s)");
    expect(warnSpy).toHaveBeenCalledWith(
      "producthunt: min_upvotes (100) filtered all 2 enriched item(s)",
    );
  });
});