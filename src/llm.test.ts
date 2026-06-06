import { describe, test, expect, spyOn } from "bun:test";
import {
  stripJsonCodeFences,
  safeComplete,
  createModel,
  summarizeItem,
  mergeItems,
  filterItemsByLlm,
  lensItems,
  formatContentItemForLlm,
} from "./llm";
import type { Model, Api, Context } from "@mariozechner/pi-ai";
import * as piAi from "@mariozechner/pi-ai";
import { makeContentItem as makeItem } from "./test/content-items";

const fakeThrowingModel = { id: "fake" } as Model<Api>;

describe("llm", () => {
  describe("stripJsonCodeFences", () => {
    test("strips json fences", () => {
      const input = '```json\n[{"id":"1"}]\n```';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"1"}]');
    });

    test("strips plain fences", () => {
      const input = '```\n[{"id":"2"}]\n```';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"2"}]');
    });

    test("strips fences with surrounding whitespace", () => {
      const input = '\n\n```json  \n  {"foo":1}  \n```  \n';
      expect(stripJsonCodeFences(input)).toBe('{"foo":1}');
    });

    test("unchanged without fences", () => {
      const input = '[{"id":"3"}]';
      expect(stripJsonCodeFences(input)).toBe('[{"id":"3"}]');
    });

    test("empty and whitespace-only", () => {
      expect(stripJsonCodeFences("")).toBe("");
      expect(stripJsonCodeFences("   \n\t  ")).toBe("");
    });

    test("strips multiple fences", () => {
      const input = '```json\n1\n``` extra ```\n2\n```';
      expect(stripJsonCodeFences(input)).toBe("1\n extra \n2");
    });
  });

  describe("summarizeItem", () => {
    test("empty body returns null", async () => {
      const item = makeItem({ body: "" });
      const res = await summarizeItem(fakeThrowingModel, item);
      expect(res).toBe(null);
    });

    test("complete error returns null", async () => {
      const item = makeItem({ title: "Test", body: "Some content" });
      const res = await summarizeItem(fakeThrowingModel, item);
      expect(res).toBe(null);
    });
  });

  describe("mergeItems filterItemsByLlm lensItems", () => {
    test("mergeItems empty list", async () => {
      const res = await mergeItems(fakeThrowingModel, []);
      expect(res).toEqual([]);
    });

    test("mergeItems passthrough on error", async () => {
      const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
      const res = await mergeItems(fakeThrowingModel, items);
      expect(res).toEqual(items);
    });

    test("filterItemsByLlm empty list", async () => {
      const res = await filterItemsByLlm(fakeThrowingModel, [], "keep tech");
      expect(res).toEqual([]);
    });

    test("filterItemsByLlm passthrough on error", async () => {
      const items = [makeItem({ id: "x" })];
      const res = await filterItemsByLlm(fakeThrowingModel, items, "some criteria");
      expect(res).toEqual(items);
    });

    test("filterItemsByLlm warns on JSON parse failure", async () => {
      const completeSpy = spyOn(piAi, "complete").mockResolvedValue({
        content: [{ type: "text", text: "not valid json {{{" }],
      } as Awaited<ReturnType<typeof piAi.complete>>);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const items = [makeItem({ id: "x" })];
        const res = await filterItemsByLlm(fakeThrowingModel, items, "keep tech");
        expect(res).toEqual(items);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^llm: JSON parse failed: /),
        );
      } finally {
        completeSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    test("lensItems empty inputs", async () => {
      const items = [makeItem()];
      expect(await lensItems(fakeThrowingModel, [], ["ai"])).toEqual([]);
      expect(await lensItems(fakeThrowingModel, items, [])).toEqual(items);
    });

    test("lensItems passthrough on error", async () => {
      const items = [makeItem({ id: "1", title: "one" }), makeItem({ id: "2", title: "two" })];
      const res = await lensItems(fakeThrowingModel, items, ["tech"]);
      expect(res).toEqual(items);
    });
  });

  describe("safeComplete", () => {
    test("complete error returns null", async () => {
      const ctx: Context = {
        systemPrompt: "test",
        messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
      };
      const res = await safeComplete(fakeThrowingModel, ctx);
      expect(res).toBe(null);
    });

    test("warns on complete failure", async () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const ctx: Context = {
          systemPrompt: "test",
          messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
        };
        const res = await safeComplete(fakeThrowingModel, ctx);
        expect(res).toBe(null);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^llm: complete failed: /),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("empty context returns null", async () => {
      const ctx: Context = {
        systemPrompt: "",
        messages: [{ role: "user", content: "", timestamp: Date.now() }],
      };
      const res = await safeComplete(fakeThrowingModel, ctx);
      expect(res).toBe(null);
    });
  });

  describe("formatContentItemForLlm", () => {
    test("minimal item without body", () => {
      const item = makeItem({ id: "i1", title: "Hello", source: "testsrc" });
      expect(formatContentItemForLlm(item)).toBe('- id: "i1" | title: "Hello" | source: testsrc');
    });

    test("truncates body when maxBodyLen > 0", () => {
      const item = makeItem({ id: "i2", title: "T", source: "s", body: "long body content here" });
      expect(formatContentItemForLlm(item, 10)).toBe('- id: "i2" | title: "T" | source: s | body: long body ');
    });

    test("omits body when maxBodyLen <= 0", () => {
      const item = makeItem({ id: "i3", title: "X", source: "y", body: "zzz" });
      expect(formatContentItemForLlm(item, 0)).toBe('- id: "i3" | title: "X" | source: y');
      expect(formatContentItemForLlm(item)).toBe('- id: "i3" | title: "X" | source: y');
    });

    test("empty body and special chars", () => {
      const item = makeItem({ id: 'id"q', title: "ti|tle", source: "src", body: "" });
      expect(formatContentItemForLlm(item, 5)).toBe('- id: "id"q" | title: "ti|tle" | source: src');
    });

    test("mergeItems uses formatting path", async () => {
      const items = [makeItem({ id: "m1", title: "m", body: "bb" })];
      expect(await mergeItems(fakeThrowingModel, items)).toEqual(items);
    });
  });

  describe("createModel", () => {
    test("incomplete config returns null", () => {
      expect(createModel({})).toBe(null);
      expect(createModel({ provider: "openai", model: "gpt-4" })).toBe(null);
      expect(createModel({ provider: "openai", api_key: "k" })).toBe(null);
    });

    test("warns on unknown provider", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const model = createModel({
          provider: "totally-unknown-provider",
          model: "custom-model-id",
          api_key: "test-key",
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          "llm: unknown provider/model (totally-unknown-provider/custom-model-id), using OpenAI-compatible fallback",
        );
        expect(model).not.toBeNull();
        expect(model!.id).toBe("custom-model-id");
        expect(model!.provider).toBe("totally-unknown-provider");
        expect(model!.api).toBe("openai-completions");
        expect(model!.baseUrl).toBe("http://localhost:11434/v1");
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("warns on unknown model id", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const model = createModel({
          provider: "openai",
          model: "__pace_test_nonexistent_model__",
          api_key: "sk-test",
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          "llm: unknown provider/model (openai/__pace_test_nonexistent_model__), using OpenAI-compatible fallback",
        );
        expect(model!.id).toBe("__pace_test_nonexistent_model__");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("null model", () => {
    test("summarizeItem skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const item = makeItem({ title: "Null Model Test" });
      const res = await summarizeItem(null, item);
      expect(res).toBe(null);
      expect(completeSpy.mock.calls.length).toBe(0);
      completeSpy.mockRestore();
    });

    test("mergeItems skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const items = [makeItem({ id: "n1" }), makeItem({ id: "n2" })];
      const res = await mergeItems(null, items);
      expect(res).toEqual(items);
      expect(completeSpy.mock.calls.length).toBe(0);
      completeSpy.mockRestore();
    });

    test("filterItemsByLlm skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const items = [makeItem({ id: "f1" })];
      const res = await filterItemsByLlm(null, items, "keep all");
      expect(res).toEqual(items);
      expect(completeSpy.mock.calls.length).toBe(0);
      completeSpy.mockRestore();
    });

    test("lensItems skips complete", async () => {
      const completeSpy = spyOn(piAi, "complete");
      const items = [makeItem({ id: "l1" })];
      const res = await lensItems(null, items, ["interest"]);
      expect(res).toEqual(items);
      expect(completeSpy.mock.calls.length).toBe(0);
      completeSpy.mockRestore();
    });
  });
});
