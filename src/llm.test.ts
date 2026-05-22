import { describe, test, expect } from "bun:test";
import {
  stripJsonCodeFences,
  safeComplete,
  summarizeItem,
  mergeItems,
  filterItemsByLlm,
  lensItems,
} from "./llm";
import type { ContentItem } from "./adapters/types";
import type { Model, Api } from "@mariozechner/pi-ai";

// Minimal fake model that will cause complete() to throw (exercises all catch paths)
const fakeThrowingModel = { id: "fake" } as Model<Api>;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-" + Math.random().toString(36).slice(2),
    title: "Default Title",
    url: "https://example.com",
    source: "test",
    timestamp: new Date(),
    body: "Default body content for LLM tests.",
    ...overrides,
  };
}

describe("llm utils (DRY quality + test coverage)", () => {
  describe("stripJsonCodeFences (extracted shared helper)", () => {
    test("strips ```json fenced blocks", () => {
      const input = '```json\n[{"id":"1"}]\n```';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"1"}]');
    });

    test("strips plain ``` fenced blocks", () => {
      const input = '```\n[{"id":"2"}]\n```';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"2"}]');
    });

    test("strips fences with surrounding whitespace and newlines", () => {
      const input = '\n\n```json  \n  {"foo":1}  \n```  \n';
      expect(stripJsonCodeFences(input)).toBe('{"foo":1}');
    });

    test("returns unchanged text when no fences present", () => {
      const input = '[{"id":"3"}]';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"3"}]');
    });

    test("handles empty string and whitespace-only", () => {
      expect(stripJsonCodeFences("")).toBe("");
      expect(stripJsonCodeFences("   \n\t  ")).toBe("");
    });

    test("strips multiple fence occurrences (defensive)", () => {
      const input = '```json\n1\n``` extra ```\n2\n```';
      expect(stripJsonCodeFences(input)).toBe("1\n extra \n2");
    });
  });

  describe("summarizeItem (graceful on error)", () => {
    test("returns null for empty body item (still calls LLM but we hit error path)", async () => {
      const item = makeItem({ body: "" });
      const res = await summarizeItem(fakeThrowingModel, item);
      expect(res).toBe(null);
    });

    test("returns null on any LLM/complete error (fake model triggers catch)", async () => {
      const item = makeItem({ title: "Test", body: "Some content" });
      const res = await summarizeItem(fakeThrowingModel, item);
      expect(res).toBe(null);
    });
  });

  describe("mergeItems / filterItemsByLlm / lensItems (graceful degradation)", () => {
    test("mergeItems returns input unchanged for empty list", async () => {
      const res = await mergeItems(fakeThrowingModel, []);
      expect(res).toEqual([]);
    });

    test("mergeItems returns original items on LLM error", async () => {
      const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
      const res = await mergeItems(fakeThrowingModel, items);
      expect(res).toEqual(items);
    });

    test("filterItemsByLlm returns input unchanged for empty list", async () => {
      const res = await filterItemsByLlm(fakeThrowingModel, [], "keep tech");
      expect(res).toEqual([]);
    });

    test("filterItemsByLlm returns original items on LLM error", async () => {
      const items = [makeItem({ id: "x" })];
      const res = await filterItemsByLlm(fakeThrowingModel, items, "some criteria");
      expect(res).toEqual(items);
    });

    test("lensItems returns input unchanged for empty items or interests", async () => {
      const items = [makeItem()];
      expect(await lensItems(fakeThrowingModel, [], ["ai"])).toEqual([]);
      expect(await lensItems(fakeThrowingModel, items, [])).toEqual(items);
    });

    test("lensItems returns original items on LLM error", async () => {
      const items = [makeItem({ id: "1", title: "one" }), makeItem({ id: "2", title: "two" })];
      const res = await lensItems(fakeThrowingModel, items, ["tech"]);
      expect(res).toEqual(items);
    });
  });

  describe("safeComplete (extracted shared error/ctx wrapper)", () => {
    test("returns null on LLM/complete error (via fakeThrowingModel)", async () => {
      const ctx = {
        systemPrompt: "test",
        messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
      } as any;
      const res = await safeComplete(fakeThrowingModel, ctx);
      expect(res).toBe(null);
    });

    test("returns null for context with empty-ish prompt (still exercises path)", async () => {
      const ctx = {
        systemPrompt: "",
        messages: [{ role: "user", content: "", timestamp: Date.now() }],
      } as any;
      const res = await safeComplete(fakeThrowingModel, ctx);
      expect(res).toBe(null);
    });
  });
});
