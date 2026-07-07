import { describe, test, expect, spyOn, afterEach } from "bun:test";
import * as piAi from "@mariozechner/pi-ai";
import {
  summarizeItems,
  mergeItems,
  filterItemsByLlm,
  lensItemsWithScores,
} from "./llm";
import { makeContentItem as makeItem } from "./test/content-items";

/**
 * Malformed LLM responses: valid JSON with the wrong shape (object instead of
 * array, missing/mis-typed fields) must pass items through unchanged instead
 * of throwing out of the transform pipeline and failing the whole refresh.
 */

const fakeModel = { id: "fake" } as piAi.Model<piAi.Api>;

let completeSpy: ReturnType<typeof spyOn> | null = null;
let warnSpy: ReturnType<typeof spyOn> | null = null;

function mockLlmText(text: string): void {
  completeSpy = spyOn(piAi, "complete").mockResolvedValue({
    content: [{ type: "text", text }],
  } as Awaited<ReturnType<typeof piAi.complete>>);
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
}

afterEach(() => {
  completeSpy?.mockRestore();
  warnSpy?.mockRestore();
  completeSpy = null;
  warnSpy = null;
});

function warningsMatching(pattern: RegExp): string[] {
  return (warnSpy?.mock.calls ?? [])
    .map((call: unknown[]) => String(call[0]))
    .filter((msg: string) => pattern.test(msg));
}

describe("summarizeItems malformed responses", () => {
  const items = [makeItem({ id: "a", title: "Alpha" }), makeItem({ id: "b", title: "Beta" })];

  test("JSON object instead of array passes through and warns", async () => {
    mockLlmText('{"summaries": [{"id": "a", "summary": "x"}]}');
    const res = await summarizeItems(fakeModel, items);
    expect(res).toEqual(items);
    expect(warningsMatching(/malformed response shape/)).toHaveLength(1);
  });

  test("invalid entries are dropped, valid ones applied", async () => {
    mockLlmText('[{"id":"a","summary":"Alpha sum."},{"id":"b"},"junk",{"id":42,"summary":"n"},null]');
    const res = await summarizeItems(fakeModel, items);
    expect(res).toEqual([{ ...items[0], summary: "Alpha sum." }, items[1]]);
  });

  test("JSON scalar passes through", async () => {
    mockLlmText("42");
    const res = await summarizeItems(fakeModel, items);
    expect(res).toEqual(items);
  });
});

describe("mergeItems malformed responses", () => {
  const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];

  test("non-array response passes through and warns", async () => {
    mockLlmText('{"merged_ids": ["a", "b"], "title": "t", "summary": "s"}');
    const res = await mergeItems(fakeModel, items);
    expect(res).toEqual(items);
    expect(warningsMatching(/malformed response shape/)).toHaveLength(1);
  });

  test("any invalid group invalidates the whole response (merge output is exhaustive)", async () => {
    // Second group is missing merged_ids; applying only the first would drop "b".
    mockLlmText('[{"merged_ids":["a"],"title":"A","summary":null},{"title":"B","summary":null}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toEqual(items);
    expect(warningsMatching(/invalid group entry/)).toHaveLength(1);
  });

  test("empty merged_ids array is invalid", async () => {
    mockLlmText('[{"merged_ids":[],"title":"A","summary":null},{"merged_ids":["a"],"title":"A","summary":null}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toEqual(items);
  });

  test("non-string summary is coerced to null (single-id group stays original)", async () => {
    mockLlmText('[{"merged_ids":["a"],"title":"A"},{"merged_ids":["b"],"title":"B","summary":7}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toEqual(items);
  });

  test("hallucinated ids in merged_ids are dropped, no ghost items fabricated", async () => {
    // Group of only unknown ids used to produce {url: "", source: "merged"} ghosts.
    mockLlmText('[{"merged_ids":["ghost1","ghost2"],"title":"Ghost","summary":"g"},{"merged_ids":["a"],"title":"A","summary":null},{"merged_ids":["b"],"title":"B","summary":null}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toEqual(items);
    expect(warningsMatching(/2 unknown item id/)).toHaveLength(1);
  });

  test("unknown id mixed into a real group is filtered from the merged id and metadata source", async () => {
    // "ghost" listed first: old code took url/source/timestamp from the missing item.
    mockLlmText('[{"merged_ids":["ghost","a","b"],"title":"Merged","summary":"s"}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("a+b");
    expect(res[0].url).toBe(items[0].url);
    expect(res[0].source).toBe(items[0].source);
    expect(res[0].timestamp).toEqual(items[0].timestamp);
    expect(res[0].body).toBe("s");
    expect(warningsMatching(/1 unknown item id/)).toHaveLength(1);
  });

  test("group reduced to a single known id without summary keeps the original item", async () => {
    mockLlmText('[{"merged_ids":["ghost","a"],"title":"Renamed","summary":null},{"merged_ids":["b"],"title":"B","summary":null}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toEqual(items);
  });

  test("id repeated across groups is kept only in the first group", async () => {
    // Old code emitted "a" twice: once merged with b, once alone.
    mockLlmText('[{"merged_ids":["a","b"],"title":"AB","summary":"s"},{"merged_ids":["a"],"title":"A again","summary":null}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("a+b");
    expect(warningsMatching(/repeated 1 item id/)).toHaveLength(1);
  });

  test("id repeated within one group is deduplicated", async () => {
    mockLlmText('[{"merged_ids":["a","a","b"],"title":"AB","summary":"s"}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("a+b");
    expect(warningsMatching(/repeated 1 item id/)).toHaveLength(1);
  });

  test("later group fully consumed by earlier claims produces no output for it", async () => {
    mockLlmText('[{"merged_ids":["a","b"],"title":"AB","summary":"s"},{"merged_ids":["b","a"],"title":"BA","summary":"x"}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("a+b");
    expect(res[0].body).toBe("s");
    expect(warningsMatching(/repeated 2 item id/)).toHaveLength(1);
  });

  test("items omitted from every group warn about being dropped", async () => {
    mockLlmText('[{"merged_ids":["a"],"title":"A","summary":null}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toEqual([items[0]]);
    expect(warningsMatching(/omitted 1 item/)).toHaveLength(1);
  });

  test("no warnings when every id is known and every item mentioned", async () => {
    mockLlmText('[{"merged_ids":["a","b"],"title":"AB","summary":"both"}]');
    const res = await mergeItems(fakeModel, items);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("a+b");
    expect(warningsMatching(/unknown item id|omitted/)).toHaveLength(0);
  });
});

describe("filterItemsByLlm malformed responses", () => {
  const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];

  test("non-array response passes through and warns", async () => {
    mockLlmText('{"keep": ["a"]}');
    const res = await filterItemsByLlm(fakeModel, items, "keep tech");
    expect(res).toEqual(items);
    expect(warningsMatching(/malformed response shape/)).toHaveLength(1);
  });

  test("non-string ids are ignored", async () => {
    mockLlmText('["a", 1, null, {"id": "b"}]');
    const res = await filterItemsByLlm(fakeModel, items, "keep tech");
    expect(res).toEqual([items[0]]);
  });
});

describe("lensItemsWithScores malformed responses", () => {
  const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];

  test("non-array response passes through with empty scoreMap", async () => {
    mockLlmText('{"a": 5, "b": 3}');
    const { items: res, scoreMap } = await lensItemsWithScores(fakeModel, items, ["tech"]);
    expect(res).toEqual(items);
    expect(scoreMap.size).toBe(0);
    expect(warningsMatching(/malformed response shape/)).toHaveLength(1);
  });

  test("entries with mis-typed or non-finite scores are dropped", async () => {
    mockLlmText('[{"id":"b","score":9},{"id":"a","score":"7"},{"id":"a","score":null},{"score":3}]');
    const { items: res, scoreMap } = await lensItemsWithScores(fakeModel, items, ["tech"]);
    // Only b has a valid score; it sorts first, a falls back to -1.
    expect(res.map((i) => i.id)).toEqual(["b", "a"]);
    expect([...scoreMap.entries()]).toEqual([["b", 9]]);
  });
});
