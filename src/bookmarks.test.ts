import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import adapter from "./adapters/bookmarks";
import type { AdapterConfig } from "./adapters/types";

function makeConfig(items: unknown[]): AdapterConfig {
  return { type: "bookmarks", params: { items } };
}

describe("bookmarks adapter", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("returns empty and warns when no items configured", async () => {
    const result = await adapter.fetch({ type: "bookmarks", params: {} });
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  test("maps valid items to ContentItems", async () => {
    const items = [
      { title: "Linear", url: "https://linear.app", description: "Issue tracker", tags: ["work", "daily"] },
      { title: "Figma", url: "https://figma.com", tags: ["design"] },
      { title: "ArXiv CS.LG", url: "https://arxiv.org/list/cs.LG/recent" },
    ];
    const result = await adapter.fetch(makeConfig(items));
    expect(result).toHaveLength(3);

    // Check first item
    expect(result[0].id).toBe("bookmarks:linear-gb1xpj");
    expect(result[0].title).toBe("Linear");
    expect(result[0].url).toBe("https://linear.app");
    expect(result[0].source).toBe("bookmarks:work");
    expect(result[0].body).toBe("Issue tracker");
    expect(result[0].timestamp).toBeInstanceOf(Date);

    // Check second item - tagged, no description
    expect(result[1].id).toBe("bookmarks:figma-lbc8jg");
    expect(result[1].source).toBe("bookmarks:design");
    expect(result[1].body).toBeUndefined();

    // Check third item - no tags, no description
    expect(result[2].id).toBe("bookmarks:arxiv-cs-lg-gx766m");
    expect(result[2].source).toBe("bookmarks");
    expect(result[2].body).toBeUndefined();
  });

  test("source is 'bookmarks' when no tags", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Example", url: "https://example.com" },
    ]));
    expect(result[0].source).toBe("bookmarks");
  });

  test("source is 'bookmarks:<first-tag>' when tagged", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Example", url: "https://example.com", tags: ["alpha", "beta"] },
    ]));
    expect(result[0].source).toBe("bookmarks:alpha");
  });

  test("items have descending timestamps to preserve config order", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "A", url: "https://a.com" },
      { title: "B", url: "https://b.com" },
      { title: "C", url: "https://c.com" },
    ]));
    // Each subsequent item has a timestamp 1ms earlier, so ORDER BY timestamp DESC
    // returns items in the same order as the config.
    expect(result[0].timestamp.getTime()).toBeGreaterThan(result[1].timestamp.getTime());
    expect(result[1].timestamp.getTime()).toBeGreaterThan(result[2].timestamp.getTime());
  });

  test("filters out items missing title", async () => {
    const result = await adapter.fetch(makeConfig([
      { url: "https://example.com" },
      { title: "", url: "https://example.com" },
      { title: "Valid", url: "https://example.com" },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  test("filters out items missing url", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "No URL" },
      { title: "Empty URL", url: "" },
      { title: "Valid", url: "https://example.com" },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  test("filters out items with non-http(s) urls", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "FTP", url: "ftp://example.com" },
      { title: "JS", url: "javascript:alert(1)" },
      { title: "Data", url: "data:text/html,<h1>hi</h1>" },
      { title: "Valid", url: "http://example.com" },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid");
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  test("filters out non-object items", async () => {
    const result = await adapter.fetch(makeConfig([
      "not-an-object",
      42,
      null,
      { title: "Valid", url: "https://example.com" },
    ]));
    expect(result).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  test("returns empty array and warns when all items are invalid", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "No URL" },
      { url: "https://example.com" },
    ]));
    expect(result).toEqual([]);
    // Two item warnings + one "all items were invalid" warning
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("non-string tags are filtered out", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Mixed Tags", url: "https://example.com", tags: [42, "valid", null] },
    ]));
    expect(result[0].source).toBe("bookmarks:valid");
  });

  test("description is included as body when present", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "With Desc", url: "https://example.com", description: "A description" },
    ]));
    expect(result[0].body).toBe("A description");
  });

  test("non-string description is ignored", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Bad Desc", url: "https://example.com", description: 123 },
    ]));
    expect(result[0].body).toBeUndefined();
  });

  test("unicode-only titles produce stable IDs with url-hash suffix", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Bibliothek", url: "https://example.com/1" },
      { title: "中文标题", url: "https://example.com/2" },
      { title: "日本語タイトル", url: "https://example.com/3" },
    ]));
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("bookmarks:bibliothek-16mxgds");
    // Unicode-only titles get empty slugs, the url hash prevents collision
    expect(result[1].id).toBe("bookmarks:-16mxgdt");
    expect(result[2].id).toBe("bookmarks:-16mxgdu");
    // Titles are preserved as-is
    expect(result[1].title).toBe("中文标题");
    expect(result[2].title).toBe("日本語タイトル");
  });

  test("empty tags array treated same as missing tags", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Empty Tags", url: "https://example.com", tags: [] },
      { title: "No Tags", url: "https://example.com/2" },
    ]));
    // Empty array is falsy for tags?.length > 0 check
    expect(result[0].source).toBe("bookmarks");
    expect(result[1].source).toBe("bookmarks");
  });

  // --- Edge case tests ---

  test("extremely long title (1000+ chars) is accepted and slugified", async () => {
    const longTitle = "A".repeat(1200);
    const result = await adapter.fetch(makeConfig([
      { title: longTitle, url: "https://example.com" },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe(longTitle);
    // slug is truncated to 40 chars by slugify; hash suffix is base36 (<= 7 chars)
    expect(result[0].id.length).toBeLessThanOrEqual("bookmarks:".length + 40 + "-".length + 7);
  });

  test("URL with query params, fragments, and special characters accepted", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Query", url: "https://example.com/search?q=hello+world&lang=en" },
      { title: "Fragment", url: "https://example.com/page#section-2" },
      { title: "Both", url: "https://example.com/path?a=1&b=2#top" },
      { title: "Encoded", url: "https://example.com/path?q=%E4%B8%AD%E6%96%87" },
    ]));
    expect(result).toHaveLength(4);
    expect(result[0].url).toBe("https://example.com/search?q=hello+world&lang=en");
    expect(result[1].url).toBe("https://example.com/page#section-2");
    expect(result[2].url).toBe("https://example.com/path?a=1&b=2#top");
    expect(result[3].url).toBe("https://example.com/path?q=%E4%B8%AD%E6%96%87");
  });

  test("title with only spaces is filtered out", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "   ", url: "https://example.com" },
      { title: "Valid", url: "https://example.com/2" },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("tags array with empty strings skips them for source", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Mixed", url: "https://example.com", tags: ["", "valid", ""] },
    ]));
    // Empty strings are skipped; first non-empty tag is used
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("bookmarks:valid");
  });

  test("url that is a number is filtered out with warning", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Bad URL", url: 123 },
      { title: "Valid", url: "https://example.com" },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Valid");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("very long description (10000+ chars) is accepted", async () => {
    const longDesc = "B".repeat(10000);
    const result = await adapter.fetch(makeConfig([
      { title: "Long Desc", url: "https://example.com", description: longDesc },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe(longDesc);
    expect(result[0].body!.length).toBe(10000);
  });

  test("items with extra unknown fields are accepted (extra fields ignored)", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Extra", url: "https://example.com", icon: "star", priority: 1, custom: true },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Extra");
    expect(result[0].url).toBe("https://example.com");
    // Extra fields are not passed through to ContentItem
    expect((result[0] as unknown as Record<string, unknown>).icon).toBeUndefined();
  });

  test("description that is an object is treated as undefined", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Obj Desc", url: "https://example.com", description: { nested: "value" } },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].body).toBeUndefined();
  });

  test("tags that is not an array is treated as undefined", async () => {
    const result = await adapter.fetch(makeConfig([
      { title: "Bad Tags", url: "https://example.com", tags: "not-array" },
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("bookmarks");
  });
});
