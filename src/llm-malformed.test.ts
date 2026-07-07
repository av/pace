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
