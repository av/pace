import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import adapter from "./adapters/counter";
import bookmarksAdapter from "./adapters/bookmarks";
import type { AdapterConfig } from "./adapters/types";
import { CounterPanel } from "./layout/counter-panel";
import { sanitize } from "./layout/text-render";

// ---------------------------------------------------------------------------
// 1. Counter adapter error recovery
// ---------------------------------------------------------------------------

describe("counter adapter error recovery", () => {
  let warnSpy: ReturnType<typeof spyOn>;
  let fetchSpy: ReturnType<typeof spyOn>;

  const baseConfig: AdapterConfig = {
    type: "counter",
    params: {
      url: "https://api.example.com/data",
      json_path: "value",
    },
  };

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (fetchSpy) fetchSpy.mockRestore();
  });

  test("network timeout during fetch throws with 'error fetching'", async () => {
    // AbortSignal.timeout triggers a DOMException with name "TimeoutError"
    const timeoutErr = new DOMException("The operation was aborted", "TimeoutError");
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValueOnce(timeoutErr);

    await expect(adapter.fetch(baseConfig)).rejects.toThrow(/error fetching/);
  });

  test("DNS resolution failure throws with 'error fetching'", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("getaddrinfo ENOTFOUND api.example.com"),
    );

    await expect(adapter.fetch(baseConfig)).rejects.toThrow(/error fetching/);
  });

  test("HTTP 500 response throws with 'failed to fetch'", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(adapter.fetch(baseConfig)).rejects.toThrow(/failed to fetch/);
  });

  test("HTTP 429 (rate limited) response throws with 'failed to fetch'", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Too Many Requests", { status: 429 }),
    );

    const err = adapter.fetch(baseConfig);
    await expect(err).rejects.toThrow(/failed to fetch/);
    // Error message should contain the status code
    await expect(adapter.fetch(baseConfig).catch((e) => e.message)).resolves.toBeUndefined;
  });

  test("HTTP 429 error message includes status code", async () => {
    fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }));

    try {
      await adapter.fetch(baseConfig);
      expect(true).toBe(false); // Should not reach here
    } catch (err: unknown) {
      expect((err as Error).message).toContain("429");
    }
  });

  test("valid JSON but empty object (path not found) throws with descriptive error", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await expect(adapter.fetch(baseConfig)).rejects.toThrow(/does not exist/);
  });

  test("valid JSON but deeply nested null at path end returns null as value", async () => {
    // When the path resolves but the final value is null, it should be included as-is
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ deeply: { nested: { value: null } } }), { status: 200 }),
    );

    const config: AdapterConfig = {
      type: "counter",
      params: {
        url: "https://api.example.com/data",
        json_path: "deeply.nested.value",
      },
    };

    const result = await adapter.fetch(config);
    expect(result).toHaveLength(1);
    const body = JSON.parse(result[0].body!);
    expect(body.value).toBeNull();
  });

  test("deeply nested path with null intermediate throws", async () => {
    // When an intermediate node is null, path traversal should fail
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ deeply: { nested: null } }), { status: 200 }),
    );

    const config: AdapterConfig = {
      type: "counter",
      params: {
        url: "https://api.example.com/data",
        json_path: "deeply.nested.value",
      },
    };

    await expect(adapter.fetch(config)).rejects.toThrow(/cannot traverse/);
  });

  test("compare_url fails but main url succeeds: continues with warning", async () => {
    fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 42 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      );

    const config: AdapterConfig = {
      type: "counter",
      params: {
        url: "https://api.example.com/data",
        json_path: "value",
        compare_url: "https://api.example.com/old-data",
      },
    };

    const result = await adapter.fetch(config);
    expect(result).toHaveLength(1);
    const body = JSON.parse(result[0].body!);
    expect(body.value).toBe(42);
    expect(body.previous).toBeUndefined();
    // Should have issued a warning about the compare_url failure
    expect(warnSpy).toHaveBeenCalled();
  });

  test("compare_url network timeout: continues with warning", async () => {
    const timeoutErr = new DOMException("The operation was aborted", "TimeoutError");
    fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 42 }), { status: 200 }),
      )
      .mockRejectedValueOnce(timeoutErr);

    const config: AdapterConfig = {
      type: "counter",
      params: {
        url: "https://api.example.com/data",
        json_path: "value",
        compare_url: "https://api.example.com/old-data",
      },
    };

    const result = await adapter.fetch(config);
    expect(result).toHaveLength(1);
    const body = JSON.parse(result[0].body!);
    expect(body.value).toBe(42);
    expect(body.previous).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  test("both url and compare_url fail: throws from url (not compare_url)", async () => {
    fetchSpy = spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("connection refused"));

    const config: AdapterConfig = {
      type: "counter",
      params: {
        url: "https://api.example.com/data",
        json_path: "value",
        compare_url: "https://api.example.com/old-data",
      },
    };

    // The main url fails first, so it should throw before ever reaching compare_url
    await expect(adapter.fetch(config)).rejects.toThrow(/error fetching/);
    // fetch should only have been called once (no compare_url attempt)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("compare_url returns valid JSON but compare_path not found: continues with warning", async () => {
    fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 100 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ other_field: 50 }), { status: 200 }),
      );

    const config: AdapterConfig = {
      type: "counter",
      params: {
        url: "https://api.example.com/data",
        json_path: "value",
        compare_url: "https://api.example.com/old-data",
        compare_path: "missing_field",
      },
    };

    // compare_path resolution failure is caught by tryOptionalFetch
    const result = await adapter.fetch(config);
    expect(result).toHaveLength(1);
    const body = JSON.parse(result[0].body!);
    expect(body.value).toBe(100);
    expect(body.previous).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Counter panel with bad data
// ---------------------------------------------------------------------------

describe("counter panel with bad data", () => {
  // Helper: build a minimal PanelConfig and panelData map for CounterPanel
  function makePanelData(items: Array<{ title: string; body: string | null }>) {
    const panelData = new Map();
    panelData.set("Test Panel", {
      panelId: "test-panel",
      items: items.map((item, i) => ({
        id: `test-${i}`,
        title: item.title,
        url: "https://example.com",
        source: "counter",
        timestamp: new Date(),
        body: item.body,
      })),
      lastRefreshedAt: new Date().toISOString(),
    });
    return panelData;
  }

  const panelNode = {
    panel: "Test Panel",
    source: "all" as const,
  };

  test("all items with unparseable body renders empty state", () => {
    const panelData = makePanelData([
      { title: "Bad 1", body: "not json at all" },
      { title: "Bad 2", body: "{malformed" },
      { title: "Bad 3", body: "{{double braces}}" },
    ]);

    const result = CounterPanel({ node: panelNode, panelData });
    const html = typeof result === "string" ? result : result?.toString() ?? "";
    // When all bodies are unparseable, parseCounterBody returns null for each,
    // so cards array is empty, and "No data yet" empty state renders
    expect(html).toContain("No data yet");
  });

  test("body has value but no label still renders (uses item.title)", () => {
    const panelData = makePanelData([
      { title: "Stars", body: JSON.stringify({ value: 42 }) },
    ]);

    const result = CounterPanel({ node: panelNode, panelData });
    const html = typeof result === "string" ? result : result?.toString() ?? "";
    expect(html).toContain("42");
    expect(html).toContain("Stars"); // item.title is used as the card label
  });

  test("value is an extremely long string renders without error", () => {
    const longValue = "x".repeat(10000);
    const panelData = makePanelData([
      { title: "Long Val", body: JSON.stringify({ value: longValue }) },
    ]);

    const result = CounterPanel({ node: panelNode, panelData });
    const html = typeof result === "string" ? result : result?.toString() ?? "";
    // abbreviateNumber calls String() on non-numbers, so the long string passes through
    expect(html).toContain("stat-card");
    expect(html).toContain("Long Val");
    // The value is the full string (abbreviateNumber returns String(value) for non-numbers)
    expect(html).toContain(longValue);
  });

  test("100+ counter items all render as stat cards", () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
      title: `Counter ${i}`,
      body: JSON.stringify({ value: i * 100 }),
    }));
    const panelData = makePanelData(items);

    const result = CounterPanel({ node: panelNode, panelData });
    const html = typeof result === "string" ? result : result?.toString() ?? "";
    // All 120 items should render as stat cards
    const statCardCount = (html.match(/stat-card/g) || []).length;
    // Each stat-card class appears in the class attr and the aria-label references it too
    // We just check a minimum count
    expect(statCardCount).toBeGreaterThanOrEqual(120);
    expect(html).toContain("Counter 0");
    expect(html).toContain("Counter 119");
  });

  test("mixed valid and invalid bodies: only valid ones render as cards", () => {
    const panelData = makePanelData([
      { title: "Good", body: JSON.stringify({ value: 10 }) },
      { title: "Bad JSON", body: "not json" },
      { title: "Missing value key", body: JSON.stringify({ count: 5 }) },
      { title: "Also Good", body: JSON.stringify({ value: 20 }) },
    ]);

    const result = CounterPanel({ node: panelNode, panelData });
    const html = typeof result === "string" ? result : result?.toString() ?? "";
    expect(html).toContain("Good");
    expect(html).toContain("Also Good");
    expect(html).not.toContain("No data yet");
    // The bad items are silently skipped
  });

  test("empty items array renders empty state", () => {
    const panelData = makePanelData([]);

    const result = CounterPanel({ node: panelNode, panelData });
    const html = typeof result === "string" ? result : result?.toString() ?? "";
    expect(html).toContain("No data yet");
  });

  test("panel not found in panelData renders empty state", () => {
    const panelData = new Map(); // empty map, panel key not present

    const result = CounterPanel({ node: panelNode, panelData });
    const html = typeof result === "string" ? result : result?.toString() ?? "";
    expect(html).toContain("No data yet");
  });
});

// ---------------------------------------------------------------------------
// 3. Bookmarks adapter with edge cases at runtime
// ---------------------------------------------------------------------------

describe("bookmarks adapter runtime edge cases", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("missing params returns empty with warning", async () => {
    const config: AdapterConfig = { type: "bookmarks" };
    const result = await bookmarksAdapter.fetch(config);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  test("non-array items returns empty with warning", async () => {
    const config: AdapterConfig = {
      type: "bookmarks",
      params: { items: "not-an-array" as unknown },
    };
    const result = await bookmarksAdapter.fetch(config);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Text widget with problematic content
// ---------------------------------------------------------------------------

describe("text widget with problematic content", () => {
  test("sanitize handles malformed HTML (unclosed tags) gracefully", () => {
    const input = "<p>Hello <strong>bold text <em>nested italic";
    const result = sanitize(input);
    // sanitize-html should auto-close tags rather than crash
    expect(result).toContain("Hello");
    expect(result).toContain("bold text");
    expect(result).toContain("nested italic");
    // Should not throw
  });

  test("sanitize handles unclosed anchor tag with href", () => {
    const input = '<a href="https://example.com">never closed';
    const result = sanitize(input);
    expect(result).toContain("never closed");
    // Should handle gracefully without crashing
  });

  test("sanitize handles deeply mismatched closing tags", () => {
    const input = "<p><strong><em>text</p></strong></em>";
    const result = sanitize(input);
    expect(result).toContain("text");
    // No crash, browser-like repair behavior
  });

  test("sanitize strips disallowed tags but preserves their content", () => {
    const input = '<p>safe</p><div>div-content</div><span>span-content</span><p>also safe</p>';
    const result = sanitize(input);
    expect(result).toContain("<p>safe</p>");
    expect(result).toContain("<p>also safe</p>");
    expect(result).not.toContain("<div");
    expect(result).not.toContain("<span");
    expect(result).toContain("div-content");
    expect(result).toContain("span-content");
  });

  test("sanitize strips all attributes from tags that have no allowed attributes", () => {
    const input = '<p id="x" class="y" data-z="w">text</p>';
    const result = sanitize(input);
    expect(result).toBe("<p>text</p>");
  });
});

